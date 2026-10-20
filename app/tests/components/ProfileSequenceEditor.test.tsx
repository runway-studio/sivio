import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ProfileSequenceEditor } from "@/components/network/ProfileSequenceEditor";
import {
  emptySequence,
  makeRule,
  readSequence,
  ruleParts,
} from "@/components/network/profileSequence";
vi.mock("@/components/JsonEditor", () => ({
  default: ({ value, onChange, ariaLabel }: any) => (
    <textarea
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));
function Harness({
  value = emptySequence,
  kind = "rules",
  source = ["DOMAIN,example.com,DIRECT", "MATCH,DIRECT"],
}: any) {
  const [data, setData] = useState(value);
  return (
    <>
      <ProfileSequenceEditor
        kind={kind}
        source={source}
        policies={["DIRECT", "REJECT", "代理"]}
        value={data}
        onChange={setData}
      />
      <output data-testid="result">{data}</output>
    </>
  );
}
const result = () =>
  readSequence(screen.getByTestId("result").textContent!, "rules");
it("adds prepend and append rules and persists removal/restoration of original rules", () => {
  render(<Harness />);
  fireEvent.change(screen.getByLabelText("规则内容"), {
    target: { value: "gitlab.example.com" },
  });
  fireEvent.click(screen.getByText("添加前置规则"));
  expect(result().prepend).toEqual(["DOMAIN,gitlab.example.com,DIRECT"]);
  fireEvent.change(screen.getByLabelText("规则类型"), {
    target: { value: "MATCH" },
  });
  fireEvent.change(screen.getByLabelText("代理策略"), {
    target: { value: "代理" },
  });
  fireEvent.click(screen.getByText("添加后置规则"));
  expect(result().append).toEqual(["MATCH,代理"]);
  fireEvent.click(screen.getByLabelText("删除 DOMAIN,example.com,DIRECT"));
  expect(result().delete).toEqual(["DOMAIN,example.com,DIRECT"]);
  fireEvent.click(screen.getByLabelText("恢复 DOMAIN,example.com,DIRECT"));
  expect(result().delete).toEqual([]);
});
it("uses original indices while filtered and preserves duplicate entries independently", () => {
  render(
    <Harness
      value={
        'prepend: ["DOMAIN,a.test,DIRECT", "DOMAIN,b.test,DIRECT", "DOMAIN,a.test,DIRECT"]\nappend: []\ndelete: []'
      }
    />,
  );
  fireEvent.change(screen.getByLabelText("搜索规则"), {
    target: { value: "b.test" },
  });
  fireEvent.click(screen.getByLabelText("删除 DOMAIN,b.test,DIRECT"));
  expect(result().prepend).toEqual([
    "DOMAIN,a.test,DIRECT",
    "DOMAIN,a.test,DIRECT",
  ]);
});
it("preserves invalid advanced drafts and reports invalid search regex without destroying entries", () => {
  render(<Harness />);
  fireEvent.click(screen.getByText("高级 YAML"));
  fireEvent.change(screen.getByLabelText("规则增强 YAML"), {
    target: { value: "prepend: [broken" },
  });
  fireEvent.click(screen.getByText("可视化"));
  expect(screen.getByLabelText("规则增强 YAML")).toHaveValue(
    "prepend: [broken",
  );
  expect(screen.getByRole("alert")).toBeInTheDocument();
});
it("edits unknown protocol objects without dropping their custom fields", () => {
  render(
    <Harness
      kind="proxies"
      source={[
        {
          name: "node",
          type: "hysteria2",
          server: "example.com",
          port: 443,
          password: "fixture",
          obfs: "salamander",
        },
      ]}
    />,
  );
  fireEvent.click(screen.getByLabelText("编辑 node"));
  const editor = screen.getByLabelText("节点对象");
  expect((editor as HTMLTextAreaElement).value).toContain("obfs: salamander");
  fireEvent.click(screen.getByText("保存到前置"));
  const seq = readSequence(
    screen.getByTestId("result").textContent!,
    "proxies",
  );
  expect(seq.delete).toEqual(["node"]);
  expect(seq.prepend[0]).toMatchObject({
    name: "node",
    obfs: "salamander",
    password: "fixture",
  });
});
it("parses nested logical rules and validates form values", () => {
  const rule = makeRule(
    "AND",
    "((DOMAIN,a.test),(NETWORK,tcp))",
    "DIRECT",
    false,
  );
  expect(ruleParts(rule)).toEqual([
    "AND",
    "((DOMAIN,a.test),(NETWORK,tcp))",
    "DIRECT",
  ]);
  expect(() => makeRule("DST-PORT", "70000", "DIRECT", false)).toThrow();
  expect(() => makeRule("DOMAIN", "a.test,REJECT", "DIRECT", false)).toThrow();
  expect(makeRule("MATCH", "", "DIRECT", false)).toBe("MATCH,DIRECT");
});

it("preserves rule flags that the visual form cannot represent", () => {
  render(<Harness source={["IP-CIDR,10.0.0.0/8,DIRECT,no-resolve,src"]} />);
  fireEvent.click(
    screen.getByLabelText("编辑 IP-CIDR,10.0.0.0/8,DIRECT,no-resolve,src"),
  );
  expect(screen.getByRole("alert")).toHaveTextContent("高级语法");
  expect(screen.getByLabelText("规则增强 YAML")).toBeInTheDocument();
  expect(
    readSequence(screen.getByTestId("result").textContent!, "rules").delete,
  ).toEqual([]);
});
