const test = require("node:test");
const assert = require("node:assert/strict");

const parseRelineCommand = require("../lib/parse-reline-command");

test("accepts a message containing the Thai reline keyword", () => {
  assert.deepEqual(parseRelineCommand("รีไลน์"), {
    isReline: true,
    countdownTarget: null,
  });
});

test("accepts a reline message with a countdown target", () => {
  assert.deepEqual(parseRelineCommand("รีไลน์ 10"), {
    isReline: true,
    countdownTarget: 10,
  });
});

test("ordinary chat and bot commands do not qualify for a shift lock", () => {
  for (const text of ["สวัสดี", "/start", "/summary", "/stats", "10", "reline"]) {
    assert.deepEqual(parseRelineCommand(text), {
      isReline: false,
      countdownTarget: null,
    });
  }
});

test("ignores countdown values outside 1 to 99 but keeps the reline command", () => {
  for (const text of ["รีไลน์ 0", "รีไลน์ 100"]) {
    assert.deepEqual(parseRelineCommand(text), {
      isReline: true,
      countdownTarget: null,
    });
  }
});
