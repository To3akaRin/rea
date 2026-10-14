import { describe, expect, it } from "vitest";
import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";
import { onlyCallable } from "./javascriptSemanticAnalysis.fixture.js";

const resultValue = (body: string) =>
  onlyCallable(
    analyzeJavaScriptSemantics(`export function result() {
    const shared = { x: 1 };
    ${body}
    return shared.x;
  }`),
    "result",
  ).returnSites[0]?.value;

describe("object-literal prototype getter receiver context", () => {
  it.each([
    [
      "saved getter result",
      "const proto={get v(){return shared}};const box={__proto__:proto};const saved=box.v;saved.x=2;",
    ],
    [
      "quoted prototype setter",
      'const proto={get v(){return shared}};const box={"__proto__":proto};box.v.x=2;',
    ],
    [
      "nested prototype chain",
      "const base={get v(){return shared}};const proto={__proto__:base};const box={__proto__:proto};box.v.x=2;",
    ],
    [
      "actual getter receiver",
      "const proto={s:{x:1},get v(){return this.s}};const box={__proto__:proto,s:shared};box.v.x=2;",
    ],
    [
      "captured prototype identity",
      "let proto={get v(){return shared}};const box={__proto__:proto};proto={};box.v.x=2;",
    ],
    [
      "a copied own getter value",
      "const source={get v(){return shared}};const box={...source};box.v.x=2;",
    ],
    [
      "a copied child's inherited getter",
      "const proto={get v(){return shared}};const source={child:{__proto__:proto}};const box={...source};box.child.v.x=2;",
    ],
    [
      "an own rest reference after an array rest",
      "const source=[{},shared];const [, ...tail]=source;const {...copy}=tail;copy[0].x=2;",
    ],
    [
      "a copied computed __proto__ property",
      'const proto={get v(){return shared}};const source={["__proto__"]:proto};const copy={...source};copy.__proto__.v.x=2;',
    ],
    [
      "an own getter not shadowed by array length",
      "const source=[];const box={get length(){return shared},...source};box.length.x=2;",
    ],
    [
      "an inherited getter not shadowed by array length",
      "const proto={get length(){return shared}};const source=[];const box={__proto__:proto,...source};box.length.x=2;",
    ],
  ])("invalidates the shared value through %s", (_name, body) => {
    expect(resultValue(body)?.status).toBe("unknown");
  });
});

describe("prototype getter shadowing and own copy boundaries", () => {
  it.each([
    [
      "read without write",
      "const proto={get v(){return shared}};const box={__proto__:proto};const saved=box.v;",
    ],
    [
      "own setter-only property",
      "const proto={get v(){return shared}};const box={__proto__:proto,set v(value){}};box.v.x=2;",
    ],
    [
      "own getter",
      "const proto={get v(){return shared}};const box={__proto__:proto,get v(){return {x:1}}};box.v.x=2;",
    ],
    [
      "own method",
      "const proto={get v(){return shared}};const box={__proto__:proto,v(){}};box.v.x=2;",
    ],
    [
      "computed __proto__ data property",
      'const proto={get v(){return shared}};const box={["__proto__"]:proto};box.v.x=2;',
    ],
    [
      "shorthand __proto__ data property",
      "const __proto__={get v(){return shared}};const box={__proto__};box.v.x=2;",
    ],
    [
      "__proto__ accessor",
      "const proto={get v(){return shared}};const box={get __proto__(){return proto}};box.v.x=2;",
    ],
    [
      "getter owner is not the receiver",
      "const proto={s:shared,get v(){return this.s}};const box={__proto__:proto,s:{x:1}};box.v.x=2;",
    ],
    [
      "literal spread shadows the prototype getter",
      "const proto={get v(){return shared}};const box={__proto__:proto,...{v:{x:1}}};box.v.x=2;",
    ],
    [
      "bound spread shadows the prototype getter",
      "const proto={get v(){return shared}};const source={v:{x:1}};const box={__proto__:proto,...source};box.v.x=2;",
    ],
    [
      "spread excludes inherited getters",
      "const proto={get v(){return shared}};const source={__proto__:proto};const box={...source};box.v.x=2;",
    ],
    [
      "rest excludes inherited getters",
      "const proto={get v(){return shared}};const source={__proto__:proto};const {...box}=source;box.v.x=2;",
    ],
    [
      "spread own selection follows a member prefix",
      "const proto={get v(){return shared}};const owner={source:{__proto__:proto}};const box={...owner.source};box.v.x=2;",
    ],
    [
      "rest own selection follows a member prefix",
      "const proto={get v(){return shared}};const owner={source:{__proto__:proto}};const {...box}=owner.source;box.v.x=2;",
    ],
    [
      "non-index selection on a copied spread array",
      "const source=[...items,shared];const {...copy}=source;copy.named.x=2;",
    ],
    [
      "spread does not copy the prototype setter as a data property",
      "const proto={get v(){return shared}};const source={__proto__:proto};const copy={...source};copy.__proto__.v.x=2;",
    ],
    [
      "escaping an object rest does not expose inherited references",
      "const proto={get v(){return shared}};const source={__proto__:proto};const {...copy}=source;mutate(copy);",
    ],
    [
      "an excluded exact key in a spread array",
      "const arr=[...[shared,{x:1}]];const {0:skip,...rest}=arr;const copy={...rest};copy[0].x=2;",
    ],
    [
      "an excluded exact key after array rest",
      "const arr=[{},shared];const [,...tail]=arr;const {0:skip,...rest}=tail;const copy={...rest};copy[0].x=2;",
    ],
    [
      "an excluded class instance field",
      "class Box{child=shared}const source=new Box();const {child,...rest}=source;const copy={...rest};copy.child.x=2;",
    ],
    [
      "an excluded static class field",
      "class Box{static child=shared}const {child,...rest}=Box;const copy={...rest};copy.child.x=2;",
    ],
    [
      "an enumerable length property shadows the getter",
      "const source={length:{x:1}};const box={get length(){return shared},...source};box.length.x=2;",
    ],
  ])("preserves an unrelated literal for %s", (_name, body) => {
    expect(resultValue(body)).toMatchObject({ status: "literal", value: 1 });
  });
});

it("terminates cyclic prototype source references", () => {
  expect(
    resultValue(
      "const first={__proto__:second};const second={__proto__:first};first.v.x=2;",
    ),
  ).toMatchObject({ status: "literal", value: 1 });
}, 1000);

it("merges visible keys across shared prototype diamonds", () => {
  const declarations = ["const root={get v(){return shared}};"];
  let previous = "root";
  for (let index = 0; index < 20; index++) {
    declarations.push(`const left${index}={__proto__:${previous},left${index}:0};
      const right${index}={__proto__:${previous},right${index}:0};
      const level${index}={__proto__:flag?left${index}:right${index}};`);
    previous = `level${index}`;
  }
  expect(
    resultValue(`${declarations.join("\n")} ${previous}[key].x=2;`)?.status,
  ).toBe("unknown");
}, 5000);
