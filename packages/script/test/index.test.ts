import assert from "node:assert/strict";
import { test } from "node:test";

import {
  abkaiToManchu,
  manchuForDisplay,
  manchuToAbkai,
  manchuToMollendorff,
  STORED_MANCHU,
  stripVariationSelectors,
} from "../src/index.ts";

test("converts Abkai words to Manchu", () => {
  assert.deepEqual(abkaiToManchu("manju"), { text: "ᠮᠠᠨᠵᡠ", invalid: [] });
  assert.equal(abkaiToManchu("bithe").text, "ᠪᡳᡨᡥᡝ");
  assert.equal(abkaiToManchu("xvn").text, "ᡧᡡᠨ");
});

test("treats q as ᠴ and qyʻ as the sequence ᡱᡳ", () => {
  assert.equal(abkaiToManchu("qooha").text, "ᠴᠣᠣᡥᠠ");
  assert.equal(abkaiToManchu("qyʻ").text, "ᡱᡳ");
});

test("reads loanword sequences before their parts", () => {
  assert.equal(abkaiToManchu("cyʻ").text, "ᡮᡟ");
  assert.equal(abkaiToManchu("syʻ").text, "ᠰᡟ");
  assert.equal(abkaiToManchu("jyʻ").text, "ᡷᡳ");
  assert.equal(abkaiToManchu("zhe").text, "ᡷᡝ");
  assert.equal(abkaiToManchu("yʻ").text, "ᡟ");
});

test("accepts a typed apostrophe as the Abkai modifier", () => {
  for (const mark of ["'", "’", "ʼ", "ʻ"]) {
    assert.equal(abkaiToManchu(`k${mark}a`).text, "ᠺᠠ");
  }
});

test("normalizes case and surrounding space", () => {
  assert.equal(abkaiToManchu(" Manju ").text, "ᠮᠠᠨᠵᡠ");
});

test("keeps unreadable letters", () => {
  assert.deepEqual(abkaiToManchu("ma?ju"), { text: "ᠮᠠ?ᠵᡠ", invalid: [] });
  assert.equal(manchuToAbkai("ᠮᠠ?ᠵᡠ").text, "ma?ju");
});

test("reports characters that are not Abkai", () => {
  assert.deepEqual(abkaiToManchu("ma1 ju"), { text: "ᠮᠠᠵᡠ", invalid: ["1", " "] });
});

test("converts Manchu to Möllendorff", () => {
  assert.equal(manchuToMollendorff("ᠮᠠᠨᠵᡠ").text, "manju");
  assert.equal(manchuToMollendorff("ᡧᡡᠨ").text, "šūn");
  assert.equal(manchuToMollendorff("ᠴᠣᠣᡥᠠ").text, "cooha");
  assert.equal(manchuToMollendorff("ᡰᡳ").text, "ži");
  assert.equal(manchuToMollendorff("ᡮᡟ").text, "ts");
});

test("round-trips every word through Abkai", () => {
  for (const abkai of ["manju", "bithe", "xvn", "qooha", "abkai", "qyʻ", "jyʻ", "cyʻ", "zhe", "kʻa"]) {
    const manchu = abkaiToManchu(abkai).text;
    assert.equal(manchuToAbkai(manchu).text, abkai);
  }
});

test("reads ᡱ alone as q, since Abkai has no separate letter for it", () => {
  assert.equal(manchuToAbkai("ᡱ").text, "q");
  assert.equal(abkaiToManchu("q").text, "ᠴ");
});

test("removes variation selectors", () => {
  assert.equal(stripVariationSelectors("ᠮ᠋ᠠ᠌ᠨ᠍"), "ᠮᠠᠨ");
  assert.equal(manchuToAbkai("ᠮ᠋ᠠ").text, "ma");
});

test("displays the standalone word i as a hook, and leaves other words unchanged", () => {
  assert.equal(manchuForDisplay("ᡳ"), "ᡳ\u180B");
  assert.equal(manchuForDisplay("ᠪᡳ"), "ᠪᡳ");
});

test("stored text allows letters and unreadable marks, but not variation selectors", () => {
  assert.match("ᠮᠠ?ᠵᡠ", STORED_MANCHU);
  assert.doesNotMatch("ᡳ\u180B", STORED_MANCHU);
  assert.doesNotMatch("manju", STORED_MANCHU);
});
