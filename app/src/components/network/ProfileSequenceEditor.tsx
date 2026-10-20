import { useMemo, useState } from "react";
import { parse, stringify } from "yaml";
import { ArrowDown, ArrowUp, RotateCcw, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import JsonEditor from "@/components/JsonEditor";
import {
  emptySequence,
  itemName,
  makeRule,
  readSequence,
  ruleParts,
  ruleTypes,
  writeSequence,
  type Item,
  type SequenceKind,
} from "./profileSequence";

const control =
  "h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm";
const labels = { rules: "规则", proxies: "节点", groups: "代理组" };
export function ProfileSequenceEditor({
  kind,
  value,
  onChange,
  source,
  policies,
  disabled = false,
}: {
  kind: SequenceKind;
  value: string;
  onChange: (value: string) => void;
  source: Item[];
  policies: string[];
  disabled?: boolean;
}) {
  const [advanced, setAdvanced] = useState(false),
    [query, setQuery] = useState(""),
    [regex, setRegex] = useState(false),
    [caseSensitive, setCaseSensitive] = useState(false);
  const [type, setType] = useState("DOMAIN"),
    [content, setContent] = useState(""),
    [policy, setPolicy] = useState("DIRECT"),
    [noResolve, setNoResolve] = useState(false);
  const [name, setName] = useState(""),
    [nodeType, setNodeType] = useState(kind === "groups" ? "select" : "ss"),
    [server, setServer] = useState(""),
    [port, setPort] = useState("443"),
    [credential, setCredential] = useState(""),
    [cipher, setCipher] = useState("aes-128-gcm"),
    [members, setMembers] = useState("DIRECT");
  const [itemYaml, setItemYaml] = useState(""),
    [customYaml, setCustomYaml] = useState(false),
    [error, setError] = useState("");
  const [editing, setEditing] = useState<{
    section: "prepend" | "append" | "original";
    index: number;
    item: Item;
  } | null>(null);
  const [page, setPage] = useState(0);
  const parsed = useMemo(() => {
    try {
      return { seq: readSequence(value || emptySequence, kind), error: "" };
    } catch (e) {
      return { seq: null, error: String(e instanceof Error ? e.message : e) };
    }
  }, [value, kind]);
  const filter = useMemo(() => {
    try {
      const re = regex ? new RegExp(query, caseSensitive ? "" : "i") : null;
      return {
        match: (text: string) =>
          re
            ? re.test(text)
            : caseSensitive
              ? text.includes(query)
              : text.toLowerCase().includes(query.toLowerCase()),
        error: "",
      };
    } catch {
      return { match: () => true, error: "搜索正则表达式无效" };
    }
  }, [query, regex, caseSensitive]);
  const seq = parsed.seq;
  const rows = seq
    ? [
        ...seq.prepend.map((item, index) => ({
          item,
          index,
          section: "prepend" as const,
        })),
        ...source.map((item, index) => ({
          item,
          index,
          section: "original" as const,
        })),
        ...seq.append.map((item, index) => ({
          item,
          index,
          section: "append" as const,
        })),
      ].filter((r) =>
        filter.match(typeof r.item === "string" ? r.item : stringify(r.item)),
      )
    : [];
  const pages = Math.max(1, Math.ceil(rows.length / 80)),
    currentPage = Math.min(page, pages - 1);
  function change(next: NonNullable<typeof seq>) {
    onChange(writeSequence(next));
    setEditing(null);
    setError("");
  }
  function createItem(): Item {
    if (kind === "rules") return makeRule(type, content, policy, noResolve);
    if (customYaml) {
      const item = parse(itemYaml, { maxAliasCount: 100 });
      if (
        !item ||
        typeof item !== "object" ||
        Array.isArray(item) ||
        typeof item.name !== "string" ||
        !item.name.trim()
      )
        throw new Error("请提供包含 name 的 YAML 对象");
      return item;
    }
    if (!name.trim()) throw new Error(`请填写${labels[kind]}名称`);
    if (kind === "groups") {
      const list = members
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean);
      if (!list.length) throw new Error("请选择至少一个成员");
      return {
        name: name.trim(),
        type: nodeType,
        proxies: list,
        ...(["url-test", "fallback", "load-balance"].includes(nodeType)
          ? { url: "https://www.gstatic.com/generate_204", interval: 300 }
          : {}),
      };
    }
    if (
      !server.trim() ||
      !Number.isInteger(+port) ||
      +port < 1 ||
      +port > 65535
    )
      throw new Error("请填写服务器和有效端口");
    if (!credential.trim()) throw new Error("请填写密码或 UUID");
    return {
      name: name.trim(),
      type: nodeType,
      server: server.trim(),
      port: +port,
      udp: true,
      ...(nodeType === "ss"
        ? { cipher, password: credential }
        : nodeType === "trojan"
          ? { password: credential }
          : { uuid: credential }),
      ...(nodeType === "vmess" ? { alterId: 0, cipher: "auto" } : {}),
    };
  }
  function add(section: "prepend" | "append") {
    if (!seq) return;
    try {
      const item = createItem();
      let next = {
        ...seq,
        prepend: [...seq.prepend],
        append: [...seq.append],
        delete: [...seq.delete],
      };
      if (editing) {
        if (editing.section === "original") {
          const key = itemName(editing.item);
          if (!next.delete.includes(key)) next.delete.push(key);
        } else next[editing.section].splice(editing.index, 1);
      }
      if (
        kind !== "rules" &&
        [...next.prepend, ...next.append].some(
          (x) => itemName(x) === itemName(item),
        )
      )
        throw new Error("名称已存在，请编辑已有条目");
      next[section].push(item);
      change(next);
      setEditing(null);
      setContent("");
      setName("");
      setCredential("");
      setPage(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  function edit(row: (typeof rows)[number]) {
    setEditing(row);
    setError("");
    if (kind === "rules") {
      const p = ruleParts(row.item as string);
      // Never silently discard flags or syntax the form cannot represent.
      try {
        const roundTrip = makeRule(
          p[0],
          p[0] === "MATCH" ? "" : p[1],
          p[p[0] === "MATCH" ? 1 : 2] || "",
          p.at(-1) === "no-resolve",
        );
        if (ruleParts(roundTrip).join(",") !== p.join(","))
          throw new Error("advanced syntax");
      } catch {
        setEditing(null);
        setAdvanced(true);
        setError(
          row.section === "original"
            ? "此原始规则含高级语法，请通过「编辑文件」修改，或在高级 YAML 中配置前置和删除规则。"
            : "此规则包含高级语法，请在 YAML 中编辑；原内容已完整保留。",
        );
        return;
      }
      setType(p[0]);
      setContent(p[0] === "MATCH" ? "" : p[1]);
      setPolicy(p[p[0] === "MATCH" ? 1 : 2] || "DIRECT");
      setNoResolve(p.at(-1) === "no-resolve");
    } else {
      setCustomYaml(true);
      setItemYaml(stringify(row.item, { lineWidth: 0 }));
    }
  }
  return (
    <div className="profile-sequence-editor space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          前置优先匹配，后置追加在原始配置之后；删除原始项会保留删除记录。
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            if (advanced && parsed.error) {
              setError(parsed.error);
              return;
            }
            setEditing(null);
            setAdvanced(!advanced);
          }}
        >
          {advanced ? "可视化" : "高级 YAML"}
        </Button>
      </div>
      {(error || parsed.error || filter.error) && (
        <p role="alert" className="text-sm text-destructive">
          {error || parsed.error || filter.error}
        </p>
      )}
      {advanced || !seq ? (
        <JsonEditor
          ariaLabel={`${labels[kind]}增强 YAML`}
          value={value}
          onChange={onChange}
          language="yaml"
          height="380px"
          readOnly={disabled}
        />
      ) : (
        <div className="profile-sequence-layout">
          <fieldset
            disabled={disabled}
            className="space-y-3 rounded-lg border bg-muted/20 p-3"
          >
            <h3 className="text-sm font-medium">
              {editing ? "编辑条目" : `添加${labels[kind]}`}
            </h3>
            {kind === "rules" ? (
              <>
                <label className="block space-y-1 text-xs">
                  规则类型
                  <select
                    aria-label="规则类型"
                    className={control}
                    value={type}
                    onChange={(e) => {
                      setType(e.target.value);
                      setNoResolve(false);
                    }}
                  >
                    {ruleTypes.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
                {type !== "MATCH" && (
                  <label className="block space-y-1 text-xs">
                    规则内容
                    <Input
                      aria-label="规则内容"
                      placeholder={
                        type.startsWith("DOMAIN")
                          ? "example.com"
                          : "规则匹配内容"
                      }
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                    />
                  </label>
                )}
                <label className="block space-y-1 text-xs">
                  代理策略
                  <Input
                    aria-label="代理策略"
                    list="profile-policy-options"
                    value={policy}
                    onChange={(e) => setPolicy(e.target.value)}
                  />
                  <datalist id="profile-policy-options">
                    {policies.map((p) => (
                      <option key={p} value={p} />
                    ))}
                  </datalist>
                </label>
                {[
                  "GEOIP",
                  "IP-ASN",
                  "IP-CIDR",
                  "IP-CIDR6",
                  "IP-SUFFIX",
                  "RULE-SET",
                ].includes(type) && (
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={noResolve}
                      onChange={(e) => setNoResolve(e.target.checked)}
                    />
                    不解析域名（no-resolve）
                  </label>
                )}
              </>
            ) : (
              <>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={customYaml}
                    onChange={(e) => setCustomYaml(e.target.checked)}
                  />
                  完整 YAML 对象（保留所有协议参数）
                </label>
                {customYaml ? (
                  <JsonEditor
                    ariaLabel={`${labels[kind]}对象`}
                    value={itemYaml}
                    onChange={setItemYaml}
                    language="yaml"
                    height="240px"
                    readOnly={disabled}
                  />
                ) : (
                  <>
                    <label className="block space-y-1 text-xs">
                      名称
                      <Input
                        aria-label={`${labels[kind]}名称`}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </label>
                    <label className="block space-y-1 text-xs">
                      类型
                      <select
                        aria-label={`${labels[kind]}类型`}
                        className={control}
                        value={nodeType}
                        onChange={(e) => setNodeType(e.target.value)}
                      >
                        {(kind === "groups"
                          ? ["select", "url-test", "fallback", "load-balance"]
                          : ["ss", "trojan", "vmess", "vless"]
                        ).map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>
                    </label>
                    {kind === "groups" ? (
                      <label className="block space-y-1 text-xs">
                        成员（每行一个节点或代理组）
                        <textarea
                          aria-label="代理组成员"
                          className="min-h-28 w-full rounded-md border bg-background p-2 text-xs"
                          value={members}
                          onChange={(e) => setMembers(e.target.value)}
                        />
                        <select
                          aria-label="添加代理组成员"
                          className={control}
                          value=""
                          onChange={(e) =>
                            setMembers(members + "\n" + e.target.value)
                          }
                        >
                          <option value="">从已有节点／分组添加</option>
                          {policies
                            .filter((p) => p !== name)
                            .map((p) => (
                              <option key={p}>{p}</option>
                            ))}
                        </select>
                      </label>
                    ) : (
                      <>
                        <label className="block space-y-1 text-xs">
                          服务器
                          <Input
                            aria-label="节点服务器"
                            value={server}
                            onChange={(e) => setServer(e.target.value)}
                          />
                        </label>
                        <label className="block space-y-1 text-xs">
                          端口
                          <Input
                            aria-label="节点端口"
                            type="number"
                            min="1"
                            max="65535"
                            value={port}
                            onChange={(e) => setPort(e.target.value)}
                          />
                        </label>
                        {nodeType === "ss" && (
                          <label className="block space-y-1 text-xs">
                            加密方式
                            <Input
                              aria-label="节点加密方式"
                              value={cipher}
                              onChange={(e) => setCipher(e.target.value)}
                            />
                          </label>
                        )}
                        <label className="block space-y-1 text-xs">
                          {["ss", "trojan"].includes(nodeType)
                            ? "密码"
                            : "UUID"}
                          <Input
                            type="password"
                            aria-label="节点凭证"
                            value={credential}
                            onChange={(e) => setCredential(e.target.value)}
                          />
                        </label>
                      </>
                    )}
                  </>
                )}
              </>
            )}
            <div className="grid gap-2">
              <Button size="sm" onClick={() => add("prepend")}>
                <ArrowUp size={13} />
                {editing ? "保存到前置" : "添加前置" + labels[kind]}
              </Button>
              <Button size="sm" variant="outline" onClick={() => add("append")}>
                <ArrowDown size={13} />
                {editing ? "保存到后置" : "添加后置" + labels[kind]}
              </Button>
              {editing && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditing(null)}
                >
                  取消编辑条目
                </Button>
              )}
            </div>
          </fieldset>
          <div className="min-w-0 space-y-2">
            <div className="flex items-center gap-2">
              <Input
                aria-label={`搜索${labels[kind]}`}
                placeholder="过滤内容、类型或策略"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
              />
              <Button
                size="icon-compact"
                variant={caseSensitive ? "default" : "ghost"}
                aria-label="区分大小写"
                aria-pressed={caseSensitive}
                onClick={() => setCaseSensitive(!caseSensitive)}
              >
                Aa
              </Button>
              <Button
                size="icon-compact"
                variant={regex ? "default" : "ghost"}
                aria-label="正则搜索"
                aria-pressed={regex}
                onClick={() => setRegex(!regex)}
              >
                .*
              </Button>
            </div>
            <div className="max-h-[430px] space-y-1 overflow-y-auto pr-1">
              {rows
                .slice(currentPage * 80, currentPage * 80 + 80)
                .map((row) => {
                  const deleted =
                    row.section === "original" &&
                    seq.delete.includes(itemName(row.item));
                  const parts =
                    kind === "rules" ? ruleParts(row.item as string) : [];
                  return (
                    <div
                      key={`${row.section}:${row.index}`}
                      className={`rounded-md border px-3 py-2 ${deleted ? "opacity-50" : row.section === "original" ? "bg-muted/30" : "border-primary/20 bg-primary/5"}`}
                    >
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p
                            className={`break-words text-xs font-medium ${deleted ? "line-through" : ""}`}
                          >
                            {kind === "rules"
                              ? parts[0] === "MATCH"
                                ? "MATCH"
                                : parts[1]
                              : itemName(row.item)}
                          </p>
                          <p className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
                            <span>
                              {row.section === "prepend"
                                ? "前置"
                                : row.section === "append"
                                  ? "后置"
                                  : deleted
                                    ? "已排除"
                                    : "原始"}
                            </span>
                            <span>
                              {kind === "rules"
                                ? parts[0]
                                : String(
                                    (row.item as Record<string, unknown>)
                                      .type ?? "",
                                  )}
                            </span>
                            <span>
                              {kind === "rules"
                                ? parts[parts[0] === "MATCH" ? 1 : 2]
                                : ""}
                            </span>
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-0.5">
                          {!deleted && (
                            <Button
                              size="icon-compact"
                              variant="ghost"
                              aria-label={`编辑 ${itemName(row.item)}`}
                              onClick={() => edit(row)}
                              disabled={disabled}
                            >
                              <Pencil size={12} />
                            </Button>
                          )}
                          {row.section !== "original" && (
                            <>
                              <Button
                                size="icon-compact"
                                variant="ghost"
                                aria-label={`上移 ${itemName(row.item)}`}
                                disabled={disabled || row.index === 0}
                                onClick={() => {
                                  const list = [
                                    ...seq[row.section as "prepend" | "append"],
                                  ];
                                  [list[row.index - 1], list[row.index]] = [
                                    list[row.index],
                                    list[row.index - 1],
                                  ];
                                  change({ ...seq, [row.section]: list });
                                }}
                              >
                                <ArrowUp size={12} />
                              </Button>
                              <Button
                                size="icon-compact"
                                variant="ghost"
                                aria-label={`转为${row.section === "prepend" ? "后置" : "前置"} ${itemName(row.item)}`}
                                disabled={disabled}
                                onClick={() => {
                                  const from = row.section as
                                      | "prepend"
                                      | "append",
                                    to =
                                      from === "prepend" ? "append" : "prepend";
                                  change({
                                    ...seq,
                                    [from]: seq[from].filter(
                                      (_, i) => i !== row.index,
                                    ),
                                    [to]: [...seq[to], row.item],
                                  });
                                }}
                              >
                                <ArrowDown size={12} />
                              </Button>
                            </>
                          )}
                          <Button
                            size="icon-compact"
                            variant="ghost"
                            disabled={disabled}
                            aria-label={`${deleted ? "恢复" : "删除"} ${itemName(row.item)}`}
                            onClick={() =>
                              row.section === "original"
                                ? change({
                                    ...seq,
                                    delete: deleted
                                      ? seq.delete.filter(
                                          (x) => x !== itemName(row.item),
                                        )
                                      : [...seq.delete, itemName(row.item)],
                                  })
                                : change({
                                    ...seq,
                                    [row.section]: seq[
                                      row.section as "prepend" | "append"
                                    ].filter((_, i) => i !== row.index),
                                  })
                            }
                          >
                            {deleted ? (
                              <RotateCcw size={12} />
                            ) : (
                              <Trash2 size={12} />
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              {!rows.length && (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  没有匹配的条目
                </p>
              )}
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {rows.length} 项 · 删除记录 {seq.delete.length}
              </span>
              {pages > 1 && (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!currentPage}
                    onClick={() => setPage(currentPage - 1)}
                  >
                    上一页
                  </Button>
                  {currentPage + 1}/{pages}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={currentPage === pages - 1}
                    onClick={() => setPage(currentPage + 1)}
                  >
                    下一页
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
