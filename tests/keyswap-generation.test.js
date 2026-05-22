const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");

function makeApi(overrides = {}) {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  const code = script.split("async function buildResources()")[0];
  const fallback = {
    value: "",
    checked: false,
    dataset: {},
    style: {},
    addEventListener() {},
    classList: { toggle() {}, add() {}, remove() {} },
  };
  const els = new Proxy({
    cols: { value: "4" },
    gap: { value: "14" },
    title: { value: "测试", dataset: {} },
    removeKeys: { checked: false },
    behavior: { value: "cycle" },
    resetActiveOnPresent: { checked: false },
    menuKey: { value: "alt" },
    clickMod: { value: "alt" },
    ...overrides,
  }, {
    get(target, prop) {
      if (!target[prop]) target[prop] = { ...fallback, dataset: {}, style: {}, classList: fallback.classList };
      return target[prop];
    },
  });

  global.document = {
    getElementById: id => els[id],
    addEventListener() {},
    querySelector() { return null; },
    createElement() {
      return { getContext() { return {}; }, style: {}, addEventListener() {}, classList: fallback.classList };
    },
  };
  global.localStorage = { getItem() { return null; }, setItem() {} };
  global.indexedDB = { open() { return {}; } };
  global.TextEncoder = TextEncoder;
  global.setTimeout = () => 0;
  global.clearTimeout = () => {};

  const api = new Function(code + `; return {
    parseSections,
    parseSwaps,
    buildIni,
    state,
    scanActiveVarsFromSections,
    getRenderActiveCondition,
    setKeySlotKey,
    normalizedKeyType,
  };`)();
  return { api, els };
}

function loadIni(api, text, fileName = "x.ini") {
  api.state.text = text;
  api.state.fileName = fileName;
  api.state.sections = api.parseSections(text);
  api.state.swaps = api.parseSwaps(api.state.sections);
  api.state.slotMeta = api.state.swaps.map(sw => ({ name: sw.sections.join("/"), skip: false }));
}

test("测试.ini maps to strict key slots", () => {
  const { api } = makeApi();
  loadIni(api, fs.readFileSync(path.join(root, "测试.ini"), "utf8"), "测试.ini");
  const out = api.buildIni();

  assert.equal(api.state.swaps.length, 10);
  assert.deepEqual(api.state.swaps.map(sw => sw.key), ["5", "6", "7", "8", "ctrl up", "ctrl down", "9", "[", "]", ";"]);
  assert.deepEqual(api.state.swaps[0].handlers.map(h => h.section), ["KeySwap0", "KeySwap00"]);
  assert.match(out, /if \$gui_clicked == 1\n  ; KeySwap0\/KeySwap00\n  if \$active == 1\n    run = CommandListCycleKeySwap0\n  endif\n  if \$black_active == 1\n    run = CommandListCycleKeySwap00\n  endif/);
  assert.match(out, /global \$ks_step_KeySwap0 = -1/);
  assert.doesNotMatch(out, /\$gui_step/);
});

test("generated ini reimport does not parse KeyGui sections", () => {
  const { api } = makeApi();
  loadIni(api, fs.readFileSync(path.join(root, "测试.ini"), "utf8"), "测试.ini");
  const generated = api.buildIni();

  const { api: api2 } = makeApi();
  loadIni(api2, generated, "测试.ini");
  assert.equal(api2.state.swaps.length, 10);
  assert.equal(api2.state.swaps.some(sw => sw.sections.some(name => /^KeyGui/i.test(name))), false);
});

test("active scan preserves exact conditions", () => {
  const { api } = makeApi();
  loadIni(api, `[KeyA]\nkey = 1\ncondition = $active == 0\ntype = cycle\n$x = 0,1\n\n[KeyB]\nkey = 2\ncondition = 2 <= $form_active && $black_active != 1\ntype = cycle\n$y = 0,1\n`);

  assert.deepEqual(api.scanActiveVarsFromSections(api.state.sections), ["$active == 0", "$black_active != 1", "$form_active >= 2"]);
  assert.equal(api.getRenderActiveCondition(), "$active == 0 || $black_active != 1 || $form_active >= 2");
});

test("duplicate section names rewrite by source index", () => {
  const { api } = makeApi();
  loadIni(api, `[KeySwap]\nkey = 1\ncondition = $a == 1\ntype = cycle\n$x = 0,1\n\n[KeySwap]\nkey = 2\ncondition = $b == 1\ntype = cycle\n$y = 0,1\n`);
  const out = api.buildIni();
  const sections = [...out.matchAll(/\[KeySwap\][\s\S]*?(?=\n\[|$)/g)].map(m => m[0]);

  assert.match(sections[0], /key = 1\ncondition = \$a == 1\nrun = CommandListCycleKeySwap/);
  assert.match(sections[1], /key = 2\ncondition = \$b == 1\nrun = CommandListCycleKeySwap_2/);
});

test("key edit updates handlers and export", () => {
  const { api } = makeApi();
  loadIni(api, `[KeySwap0]\nkey = 5\ncondition = $active == 1\ntype = cycle\n$x = 0,1\n\n[KeySwap00]\nkey = 5\ncondition = $black_active == 1\ntype = cycle\n$y = 0,1\n`);
  api.setKeySlotKey(api.state.swaps[0], "7");
  const out = api.buildIni();

  assert.equal(api.state.swaps[0].key, "7");
  assert.equal(api.state.swaps[0].handlers.every(h => h.key === "7"), true);
  assert.match(out, /\[KeySwap0\]\nkey = 7\ncondition = \$active == 1\nrun = CommandListCycleKeySwap0/);
  assert.match(out, /\[KeySwap00\]\nkey = 7\ncondition = \$black_active == 1\nrun = CommandListCycleKeySwap00/);
});

test("toggle normalizes to cycle", () => {
  const { api } = makeApi();
  loadIni(api, `[KeyT]\nkey = 1\ncondition = $active == 1\ntype = toggle\n$x = 0,1\n`);
  const out = api.buildIni();

  assert.equal(api.normalizedKeyType("toggle"), "cycle");
  assert.match(out, /global \$ks_step_KeyT = -1/);
});

test("Present generated block is replaced, not duplicated", () => {
  const { api } = makeApi();
  loadIni(api, `[Present]\nif $gui_menu && ($old_active)\n  run = CommandListGuiMenu\nendif\n\nif $user_condition\n  run = CommandListUser\nendif\n\n[KeySwap0]\nkey = 1\ncondition = $active == 1\ntype = cycle\n$x = 0,1\n`);
  const out1 = api.buildIni();
  const { api: api2 } = makeApi();
  loadIni(api2, out1);
  const out2 = api2.buildIni();
  const present = out2.match(/\[Present\][\s\S]*?(?=\n\[|$)/)[0];

  assert.equal((present.match(/run = CommandListGuiMenu/g) || []).length, 1);
  assert.match(present, /run = CommandListUser/);
});
