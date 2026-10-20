import { parse, stringify } from "yaml";
export type Item = string | Record<string, unknown>;
export type Sequence = {
  prepend: Item[];
  append: Item[];
  delete: string[];
  [key: string]: unknown;
};
export type SequenceKind = "rules" | "proxies" | "groups";
export const emptySequence = "prepend: []\nappend: []\ndelete: []\n";
export function readSequence(value: string, kind: SequenceKind): Sequence {
  const data = parse(value, { maxAliasCount: 100 });
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("增强配置必须是包含 prepend、append、delete 的对象");
  for (const key of ["prepend", "append", "delete"] as const) {
    if (data[key] !== undefined && !Array.isArray(data[key]))
      throw new Error(`${key} 必须是列表`);
  }
  const seq = {
    ...data,
    prepend: data.prepend ?? [],
    append: data.append ?? [],
    delete: data.delete ?? [],
  } as Sequence;
  if (!seq.delete.every((v) => typeof v === "string"))
    throw new Error("delete 必须是名称或规则字符串列表");
  if (
    ![...seq.prepend, ...seq.append].every((v) =>
      kind === "rules"
        ? typeof v === "string"
        : v &&
          typeof v === "object" &&
          !Array.isArray(v) &&
          typeof v.name === "string",
    )
  )
    throw new Error(
      kind === "rules" ? "规则必须是字符串" : "节点和代理组必须包含 name",
    );
  return seq;
}
export function itemName(item: Item): string {
  return typeof item === "string" ? item : String(item.name ?? "");
}
export function writeSequence(seq: Sequence) {
  return stringify(seq, { lineWidth: 0 });
}
export function ruleParts(rule: string) {
  const parts: string[] = [];
  let depth = 0,
    start = 0;
  for (let i = 0; i < rule.length; i++) {
    if (rule[i] === "(") depth++;
    else if (rule[i] === ")") depth--;
    else if (rule[i] === "," && depth === 0) {
      parts.push(rule.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(rule.slice(start).trim());
  return parts;
}
export const ruleTypes = [
  "DOMAIN",
  "DOMAIN-SUFFIX",
  "DOMAIN-KEYWORD",
  "DOMAIN-REGEX",
  "GEOSITE",
  "GEOIP",
  "SRC-GEOIP",
  "IP-ASN",
  "SRC-IP-ASN",
  "IP-CIDR",
  "IP-CIDR6",
  "SRC-IP-CIDR",
  "IP-SUFFIX",
  "SRC-IP-SUFFIX",
  "SRC-PORT",
  "DST-PORT",
  "IN-PORT",
  "DSCP",
  "PROCESS-NAME",
  "PROCESS-PATH",
  "PROCESS-NAME-REGEX",
  "PROCESS-PATH-REGEX",
  "NETWORK",
  "UID",
  "IN-TYPE",
  "IN-USER",
  "IN-NAME",
  "SUB-RULE",
  "RULE-SET",
  "AND",
  "OR",
  "NOT",
  "MATCH",
];
export function makeRule(
  type: string,
  content: string,
  policy: string,
  noResolve: boolean,
) {
  const text = content.trim();
  if (!ruleTypes.includes(type)) throw new Error("请选择规则类型");
  if (type !== "MATCH" && !text) throw new Error("请填写规则内容");
  if (!policy.trim() || /[,\r\n]/.test(policy))
    throw new Error("请选择有效的代理策略");
  if (
    /[\r\n]/.test(text) ||
    (!["AND", "OR", "NOT", "SUB-RULE"].includes(type) && text.includes(","))
  )
    throw new Error("规则内容不能包含换行或逗号");
  if (
    ["SRC-PORT", "DST-PORT", "IN-PORT"].includes(type) &&
    !/^\d{1,5}(?:-\d{1,5})?$/.test(text)
  )
    throw new Error("端口应为 1–65535 或端口范围");
  if (
    ["SRC-PORT", "DST-PORT", "IN-PORT"].includes(type) &&
    text.split("-").some((v) => +v < 1 || +v > 65535)
  )
    throw new Error("端口应为 1–65535");
  if (type === "NETWORK" && !["tcp", "udp"].includes(text.toLowerCase()))
    throw new Error("NETWORK 仅支持 tcp 或 udp");
  return [
    type,
    ...(type === "MATCH" ? [] : [text]),
    policy.trim(),
    ...(noResolve ? ["no-resolve"] : []),
  ].join(",");
}
export function sourceConfig(yaml: string): Record<string, unknown> {
  const data = parse(yaml, { maxAliasCount: 100 });
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("配置必须是 YAML 对象");
  return data;
}
