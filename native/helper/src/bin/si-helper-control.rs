//! Local validation client and installation bridge; it never accepts a core executable from IPC.
use anyhow::{Context,Result,ensure};
use clash_verge_service_ipc as ipc;
use std::{path::PathBuf,io::Read};

fn root()->Result<PathBuf> {
    let root=std::env::var_os("SI_VALIDATION_ROOT").map(PathBuf::from).context("SI_VALIDATION_ROOT is required")?;
    std::fs::create_dir_all(&root)?;
    #[cfg(unix)] {use std::os::unix::fs::PermissionsExt;std::fs::set_permissions(&root,std::fs::Permissions::from_mode(0o700))?;}
    Ok(root.canonicalize()?)
}
fn credentials()->Result<ipc::OwnerCredentials> {
    Ok(ipc::OwnerCredentials{identity:ipc::OwnerIdentity::Unix{uid:unsafe{libc_uid()},gid:unsafe{libc_gid()}},app_data_dir:root()?.to_string_lossy().into_owned(),token:None})
}
unsafe fn libc_uid()->u32{unsafe{platform_lib::geteuid()}}
unsafe fn libc_gid()->u32{unsafe{platform_lib::getegid()}}
fn proof()->Result<ipc::OwnerSessionProof> {Ok(serde_json::from_slice(&std::fs::read(root()?.join("session.json"))?)?)}
fn cdhash()->Result<String> {
    let output=std::process::Command::new("/usr/bin/codesign").args(["-d","--verbose=4"]).arg(std::env::current_exe()?).output()?;
    ensure!(output.status.success(),"validation client must be ad-hoc signed before installation");
    String::from_utf8(output.stderr)?.lines().find_map(|line|line.strip_prefix("CDHash=").map(str::to_owned)).context("client CDHash unavailable")
}
#[tokio::main]
async fn main()->Result<()> {
    let args=std::env::args().collect::<Vec<_>>();
    match args.get(1).map(String::as_str) {
        Some("install")=>{
            let installer=std::env::current_exe()?.with_file_name("sivio-helper-install");
            let core=PathBuf::from(args.get(2).context("install requires a verified core source")?);
            let hash=cdhash()?;
            let mut command=std::process::Command::new(installer);
            command.args(["--prepare-install","--prompt","Sivio 安装独立网络服务以验证 TUN 与崩溃恢复","--client-cdhash",&hash]);
            if let Some(app_hash)=args.get(3){command.args(["--client-cdhash",app_hash]);}
            let status=command.args(["--core","verge-mihomo"]).arg(core).status()?;
            ensure!(status.success(),"installation was refused or failed");
            println!("helper installed with explicitly trusted validation client");
        },
        Some("crash-helper")|Some("expired-crash-helper")=>{let installer=std::env::current_exe()?.with_file_name("sivio-helper-install");ensure!(std::process::Command::new(installer).arg(if args[1]=="expired-crash-helper"{"--prepare-expired-crash-validation"}else{"--prepare-crash-validation"}).status()?.success(),"crash validation failed or refused");},
        Some("control")=>{let method=args.get(2).context("control method required")?;let path=args.get(3).context("control path required")?;let body=args.get(4).map(|b|serde_json::from_str(b)).transpose()?;let response=ipc::control_mihomo(&credentials()?,&proof()?,&ipc::MihomoControlRequest{method:method.clone(),path:path.clone(),body}).await?;ensure!(response.code==0,"control rejected: {}",response.message);println!("{}",serde_json::to_string(&response.data)?);},
        Some("proxy")=>{let response=ipc::set_system_proxy(&credentials()?,&proof()?,&ipc::MacosProxyConfig::Global{host:"127.0.0.1".into(),port:15782,bypass:"localhost,127.*,::1".into()}).await?;ensure!(response.code==0,"proxy apply rejected: {}",response.message);println!("owned proxy applied");},
        Some("logs")=>{let response=ipc::get_clash_logs(&credentials()?).await?;ensure!(response.code==0,"logs rejected");println!("{}",serde_json::to_string(&response.data)?);},
        Some("status")=>{let response=ipc::get_status(&credentials()?).await?;println!("{}",serde_json::to_string(&response)?);},
        Some("version")=>println!("{}",serde_json::to_string(&ipc::get_version().await?)?),
        Some("start")=>{
            let yaml=std::fs::read_to_string(args.get(2).context("start requires a YAML file")?)?;
            let mut bytes=[0u8;32];std::fs::File::open("/dev/urandom")?.read_exact(&mut bytes)?;
            let token=bytes.iter().map(|b|format!("{b:02x}")).collect::<String>();
            let core=ipc::service_paths()?.core_dir().join("verge-mihomo");
            let response=ipc::start_clash(&credentials()?,&ipc::StartClashRequest{
                runtime:ipc::RuntimeBundle{yaml,assets:vec![],remote_providers:vec![],core_path:core.to_string_lossy().into_owned()},
                proposed_session_token:token.clone(),macos_proxy:if args.get(3).map(String::as_str)==Some("proxy") {Some(ipc::MacosProxyConfig::Global{host:"127.0.0.1".into(),port:15782,bypass:"localhost,127.*,::1".into()})}else{None},
            }).await?;
            ensure!(response.code==0,"start rejected: {}",response.message);
            let generation=response.data.context("start omitted session")?.session.generation;
            let session=ipc::OwnerSessionProof{generation,token};
            let path=root()?.join("session.json");
            use std::os::unix::fs::OpenOptionsExt;use std::io::Write;
            let mut out=std::fs::OpenOptions::new().create(true).truncate(true).write(true).mode(0o600).open(path)?;
            out.write_all(&serde_json::to_vec(&session)?)?;out.sync_all()?;
            println!("generation {generation} started");
        },
        Some("renew")=>{let response=ipc::renew_owner(&credentials()?,&proof()?).await?;ensure!(response.code==0,"renewal rejected: {}",response.message);println!("renewed");},
        Some("watch")=>{
            let seconds=args.get(2).map(|s|s.parse::<u64>()).transpose()?.unwrap_or(60);
            let started=std::time::Instant::now();
            let mut last_good=std::time::Instant::now();
            while started.elapsed().as_secs()<seconds {
                match ipc::renew_owner(&credentials()?,&proof()?).await {
                    Ok(response) if response.code==0=>last_good=std::time::Instant::now(),
                    Ok(response)=>anyhow::bail!("renewal rejected: {}",response.message),
                    Err(_)=>{ensure!(last_good.elapsed().as_secs()<25,"helper renewal unavailable for 25 seconds");eprintln!("transient helper disconnect; retrying");}
                }
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            }
            println!("renewal watch completed");
        },
        Some("stop")=>{let response=ipc::stop_clash(&credentials()?,&proof()?).await?;ensure!(response.code==0,"stop rejected: {}",response.message);println!("stopped");},
        _=>anyhow::bail!("use install <core> | version | status | start <yaml> | renew | watch <seconds> | stop"),
    }
    Ok(())
}
