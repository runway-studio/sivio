import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import {
  MoreHorizontal,
  FileCode2,
  Code2,
  FolderOpen,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import JsonEditor from "@/components/JsonEditor";
import { usePendingMutation, useUnsavedValue } from "@/lib/unsavedChanges";
import { toast } from "@/lib/toast";
import { networkApi as api } from "./networkApi";
import type { NetworkSnapshot, Profile } from "./networkTypes";
import { ProfileSequenceEditor } from "./ProfileSequenceEditor";
import {
  emptySequence,
  readSequence,
  sourceConfig,
  type Item,
  type SequenceKind,
} from "./profileSequence";
import "./profile-tools.css";

type Target =
  | "yaml"
  | "rules"
  | "proxies"
  | "groups"
  | "merge"
  | "script"
  | "qr";
const titles: Record<Target, string> = {
  yaml: "编辑文件",
  rules: "编辑规则",
  proxies: "编辑节点",
  groups: "编辑代理组",
  merge: "扩展覆写配置",
  script: "扩展脚本",
  qr: "分享二维码",
};
const defaults = {
  enabled: false,
  merge: "{}",
  script: "",
  rules: emptySequence,
  proxies: emptySequence,
  groups: emptySequence,
  dnsMode: "inherit",
  dns: "{}",
};
type Payload = {
  yaml: string;
  url?: string;
  enhancement?: typeof defaults;
  requestOptions?: Record<string, unknown>;
  [key: string]: unknown;
};
type Document = {
  target: Target;
  value: string;
  saved: string;
  payload: Payload | null;
  snapshot: NetworkSnapshot;
  profile?: Profile;
  enabled: boolean;
  originalEnabled: boolean;
};
export function ProfileTools({
  profile,
  snapshot,
  onEditInfo,
  onDelete,
  disabled = false,
}: {
  profile?: Profile;
  snapshot: NetworkSnapshot;
  onEditInfo?: () => void;
  onDelete?: () => void;
  disabled?: boolean;
}) {
  const client = useQueryClient();
  const [doc, setDoc] = useState<Document | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [preview, setPreview] = useState<string | null>(null),
    [external, setExternal] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const card = triggerRef.current?.closest("article");
    if (!card) return;
    const handle = (event: Event) => {
      event.preventDefault();
      if (!disabled && !busy) setMenuOpen(true);
    };
    card.addEventListener("contextmenu", handle);
    return () => card.removeEventListener("contextmenu", handle);
  }, [profile?.id, disabled, busy]);
  const dirty =
    !!doc && (doc.value !== doc.saved || doc.enabled !== doc.originalEnabled);
  useUnsavedValue(dirty);
  usePendingMutation(busy);
  function close() {
    if (!busy && (!dirty || window.confirm("有尚未保存的修改，确定放弃吗？"))) {
      setDoc(null);
      setPreview(null);
      setError("");
    }
  }
  async function operation(fn: () => Promise<unknown>, success?: string) {
    setBusy(true);
    setError("");
    try {
      await fn();
      if (success) toast.success(success);
      await client.invalidateQueries({ queryKey: ["network"] });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      if (!doc) toast.error(message);
    } finally {
      setBusy(false);
    }
  }
  async function open(target: Target, openExternal = false) {
    setBusy(true);
    setError("");
    setPreview(null);
    setExternal(openExternal);
    try {
      const latest = await api<NetworkSnapshot>("snapshot");
      const record = profile
        ? latest.catalog.profiles.find((p) => p.id === profile.id)
        : undefined;
      if (profile && !record) throw new Error("订阅已删除，请刷新列表");
      const contextId = record?.id ?? latest.catalog.active;
      const payload = contextId
        ? await api<Payload>("profile.read", { id: contextId })
        : null;
      const value =
        target === "qr"
          ? (payload?.url ?? "")
          : target === "yaml"
            ? (payload?.yaml ?? "")
            : record
              ? { ...defaults, ...payload?.enhancement }[target]
              : latest.catalog.settings[target as "merge" | "script"];
      setDoc({
        target,
        value,
        saved: value,
        payload,
        snapshot: latest,
        profile: record,
        enabled: payload?.enhancement?.enabled ?? false,
        originalEnabled: payload?.enhancement?.enabled ?? false,
      });
      if (openExternal && record)
        await api("profile.file.open", {
          id: record.id,
          baseRevision: record.revision,
        });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  function draftValue() {
    if (!doc) throw new Error("编辑器未就绪");
    const enhancement = {
      ...defaults,
      ...doc.payload?.enhancement,
      ...(doc.target !== "yaml" && doc.target !== "qr"
        ? { [doc.target]: doc.value, enabled: doc.enabled }
        : {}),
    };
    return {
      id: doc.profile?.id,
      baseRevision: doc.profile?.revision,
      name: doc.profile?.name,
      kind: doc.profile?.kind,
      interval: doc.profile?.interval,
      url: doc.payload?.url ?? "",
      requestOptions: doc.payload?.requestOptions,
      yaml: doc.target === "yaml" ? doc.value : doc.payload?.yaml,
      enhancement,
    };
  }
  async function save() {
    if (!doc) return;
    await operation(async () => {
      if (["rules", "proxies", "groups"].includes(doc.target))
        readSequence(doc.value, doc.target as SequenceKind);
      if (doc.profile) await api("profile.save", draftValue());
      else
        await api("settings.save", {
          settings: {
            ...doc.snapshot.catalog.settings,
            [doc.target]: doc.value,
          },
          baseRevision: doc.snapshot.settingsRevision,
        });
      setDoc(null);
    }, "配置已验证并保存");
  }
  let source: Record<string, unknown> = {},
    sourceError = "";
  if (doc?.payload) {
    try {
      source = sourceConfig(doc.payload.yaml);
    } catch (e) {
      sourceError = String(e instanceof Error ? e.message : e);
    }
  }
  // Policy choices include all local additions; never silently replace an unknown policy.
  const choices = new Set([
    "DIRECT",
    "REJECT",
    "REJECT-DROP",
    "PASS",
    "COMPATIBLE",
  ]);
  for (const field of ["proxy-groups", "proxies"])
    if (Array.isArray(source[field]))
      for (const item of source[field] as Record<string, unknown>[])
        if (item && typeof item.name === "string") choices.add(item.name);
  for (const field of ["groups", "proxies"] as const) {
    try {
      const s = readSequence(
        doc?.target === field
          ? doc.value
          : { ...defaults, ...doc?.payload?.enhancement }[field],
        field,
      );
      for (const item of [...s.prepend, ...s.append])
        if (typeof item === "object") choices.add(String(item.name));
    } catch {
      /* Editor displays validation errors. */
    }
  }
  const sequence = doc && ["rules", "proxies", "groups"].includes(doc.target);
  const sourceItems = sequence
    ? source[doc.target === "groups" ? "proxy-groups" : doc.target]
    : [];
  const isRunning = snapshot.runtime.phase === "running";
  const entries: [string, () => void, boolean?][] = profile
    ? [
        [
          "使用",
          () =>
            void operation(
              () => api("profile.select", { id: profile.id }),
              "已切换订阅",
            ),
          snapshot.catalog.active === profile.id,
        ],
        ...(profile.kind === "remote"
          ? [["分享二维码", () => void open("qr")] as [string, () => void]]
          : []),
        ["编辑信息", () => onEditInfo?.()],
        ["编辑文件", () => void open("yaml")],
        ["编辑规则", () => void open("rules")],
        ["编辑节点", () => void open("proxies")],
        ["编辑代理组", () => void open("groups")],
        ["扩展覆写配置", () => void open("merge")],
        ["扩展脚本", () => void open("script")],
        ["打开文件", () => void open("yaml", true)],
        ...(profile.kind === "remote"
          ? [
              [
                "更新",
                () =>
                  void operation(
                    () =>
                      api("profile.update", { id: profile.id, via: "direct" }),
                    "订阅已更新",
                  ),
              ] as [string, () => void],
              [
                "更新（代理）",
                () =>
                  void operation(
                    () =>
                      api("profile.update", {
                        id: profile.id,
                        via: isRunning ? "managed-network" : "system-proxy",
                      }),
                    "订阅已通过代理更新",
                  ),
              ] as [string, () => void],
            ]
          : []),
        ["删除", () => onDelete?.(), snapshot.runtime.active === profile.id],
      ]
    : [];
  return (
    <>
      {profile ? (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              ref={triggerRef}
              data-profile-menu
              aria-label={`订阅操作 ${profile.name}`}
              title="订阅操作"
              size="icon-compact"
              variant="ghost"
              disabled={disabled || busy}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenuOpen(true);
              }}
            >
              <MoreHorizontal size={17} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="max-h-[70vh] overflow-y-auto"
          >
            {entries.map(([label, action, unavailable]) => (
              <DropdownMenuItem
                key={label}
                disabled={unavailable}
                onSelect={action}
                className={label === "删除" ? "text-destructive" : ""}
              >
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {(["merge", "script"] as const).map((target) => (
            <button
              key={target}
              disabled={busy || disabled}
              onClick={() => void open(target)}
              className="flex items-center gap-3 rounded-xl border bg-card p-4 text-left hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {target === "merge" ? (
                <FileCode2 size={20} className="text-primary" />
              ) : (
                <Code2 size={20} className="text-primary" />
              )}
              <span>
                <span className="block text-sm font-medium">
                  全局{titles[target]}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  应用于所有订阅 · 点击编辑
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
      {doc && (
        <Dialog
          open
          onOpenChange={(v) => {
            if (!v) close();
          }}
        >
          <DialogContent
            className={`${sequence ? "max-w-[940px]" : "max-w-[800px]"} w-[calc(100%_-_32px)] max-h-[88vh] overflow-hidden`}
            onEscapeKeyDown={(e) => {
              e.preventDefault();
              close();
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {!doc.profile ? "全局" : ""}
                {titles[doc.target]}
                {doc.profile && (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    {doc.profile.name}
                  </span>
                )}
              </DialogTitle>
              <DialogDescription>
                {doc.target === "qr"
                  ? "二维码包含订阅凭证，仅分享给可信的人。"
                  : doc.target === "yaml"
                    ? "原始文件可能被订阅更新覆盖；需长期保留的改动请使用规则、节点或扩展编辑。"
                    : !doc.profile
                      ? "全局增强应用于所有订阅，保存前会验证当前订阅的最终配置。"
                      : "订阅增强独立保存，更新订阅时保留；保存前会验证最终配置。"}
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 space-y-3 overflow-y-auto px-6 py-4">
              {doc.target === "qr" ? (
                <div className="flex flex-col items-center gap-4 rounded-xl bg-white p-6 text-black">
                  {!doc.value ? (
                    <p>此订阅没有可分享的地址</p>
                  ) : new TextEncoder().encode(doc.value).length > 2000 ? (
                    <p>订阅地址过长，请复制链接分享。</p>
                  ) : (
                    <QRCodeSVG
                      value={doc.value}
                      size={240}
                      level="M"
                      marginSize={4}
                      title="订阅地址二维码"
                    />
                  )}
                  <Button
                    variant="outline"
                    disabled={!doc.value}
                    onClick={() =>
                      void operation(
                        () => navigator.clipboard.writeText(doc.value),
                        "订阅链接已复制",
                      )
                    }
                  >
                    复制订阅链接
                  </Button>
                </div>
              ) : (
                <>
                  {doc.profile && doc.target !== "yaml" && (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={doc.enabled}
                        disabled={busy}
                        onChange={(e) =>
                          setDoc({ ...doc, enabled: e.target.checked })
                        }
                      />
                      启用此订阅增强
                      {!doc.enabled && (
                        <span className="text-xs text-muted-foreground">
                          修改内容时自动启用
                        </span>
                      )}
                    </label>
                  )}
                  {sourceError && (
                    <p role="alert" className="text-sm text-destructive">
                      {sourceError}
                    </p>
                  )}
                  {sequence ? (
                    <ProfileSequenceEditor
                      kind={doc.target as SequenceKind}
                      value={doc.value}
                      onChange={(value) => {
                        setDoc({ ...doc, value, enabled: true });
                        setPreview(null);
                      }}
                      source={
                        Array.isArray(sourceItems)
                          ? (sourceItems as Item[])
                          : []
                      }
                      policies={[...choices]}
                      disabled={busy}
                    />
                  ) : (
                    <JsonEditor
                      ariaLabel={titles[doc.target]}
                      value={doc.value}
                      onChange={(value) => {
                        setDoc({
                          ...doc,
                          value,
                          enabled:
                            doc.profile && doc.target !== "yaml"
                              ? true
                              : doc.enabled,
                        });
                        setPreview(null);
                      }}
                      language={doc.target === "script" ? "javascript" : "yaml"}
                      height="360px"
                      readOnly={busy}
                    />
                  )}
                  {doc.target === "yaml" && doc.profile && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void operation(async () => {
                            await api("profile.file.open", {
                              id: doc.profile!.id,
                              baseRevision: doc.profile!.revision,
                            });
                            setExternal(true);
                          })
                        }
                      >
                        <FolderOpen size={14} />
                        外部编辑器打开
                      </Button>
                      {external && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            void operation(async () => {
                              if (
                                dirty &&
                                !window.confirm(
                                  "读取外部文件将替换当前草稿，继续吗？",
                                )
                              )
                                return;
                              const r = await api<{ yaml: string }>(
                                "profile.file.read",
                                {
                                  id: doc.profile!.id,
                                  baseRevision: doc.profile!.revision,
                                },
                              );
                              setDoc({ ...doc, value: r.yaml });
                              setPreview(null);
                            })
                          }
                        >
                          读取外部修改
                        </Button>
                      )}
                      <span className="text-xs text-muted-foreground">
                        外部文件为私有工作副本，读取并保存后生效。
                      </span>
                    </div>
                  )}
                  {preview && (
                    <details open>
                      <summary className="cursor-pointer text-sm">
                        最终生效配置
                      </summary>
                      <JsonEditor
                        ariaLabel="最终生效配置"
                        value={preview}
                        onChange={() => {}}
                        language="yaml"
                        height="260px"
                        readOnly
                      />
                    </details>
                  )}
                </>
              )}
              {error && (
                <p
                  role="alert"
                  className="break-words rounded-md bg-destructive/5 p-3 text-sm text-destructive"
                >
                  {error}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" disabled={busy} onClick={close}>
                {doc.target === "qr" ? "关闭" : "取消"}
              </Button>
              {doc.target !== "qr" && (
                <>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void operation(async () => {
                        const r = await api<{ yaml: string }>(
                          "preview",
                          doc.profile
                            ? draftValue()
                            : {
                                yaml:
                                  doc.payload?.yaml ??
                                  'proxies: []\nproxy-groups: []\nrules: ["MATCH,DIRECT"]',
                                settings: {
                                  ...doc.snapshot.catalog.settings,
                                  [doc.target]: doc.value,
                                },
                                enhancement: doc.payload?.enhancement,
                                name: doc.snapshot.catalog.profiles.find(
                                  (p) => p.id === doc.snapshot.catalog.active,
                                )?.name,
                              },
                        );
                        setPreview(r.yaml);
                      })
                    }
                  >
                    预览生效配置
                  </Button>
                  <Button disabled={busy} onClick={() => void save()}>
                    {busy && <Loader2 size={14} className="animate-spin" />}保存
                    {doc.profile?.id === snapshot.runtime.active && isRunning
                      ? "并应用"
                      : ""}
                  </Button>
                </>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
