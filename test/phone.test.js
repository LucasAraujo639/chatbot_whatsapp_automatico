import test from "node:test";
import assert from "node:assert/strict";
import { numberOf, isValidNumber, numberVariants, phoneNumbersOf, findContact } from "../src/phone.js";

test("numberOf quita dominio y dispositivo", () => {
  assert.equal(numberOf("59897117916@s.whatsapp.net"), "59897117916");
  assert.equal(numberOf("59897117916:12@s.whatsapp.net"), "59897117916");
});

test("isValidNumber", () => {
  assert.equal(isValidNumber("59897117916"), true);
  for (const bad of ["", "0123456789", "123", "1".repeat(16), "+5989711"]) assert.equal(isValidNumber(bad), false);
});

test("variantes Argentina y México", () => {
  assert.deepEqual(numberVariants("5491134700227").sort(), ["541134700227", "5491134700227"]);
  assert.deepEqual(numberVariants("541134700227").sort(), ["541134700227", "5491134700227"]);
  assert.deepEqual(numberVariants("5215512345678").sort(), ["5215512345678", "525512345678"]);
  assert.deepEqual(numberVariants("59897117916"), ["59897117916"]);
});

test("phoneNumbersOf ignora @lid y valores vacíos", () => {
  assert.deepEqual(phoneNumbersOf(["123456789012345@lid", undefined, "59897117916@s.whatsapp.net"]), ["59897117916"]);
});

test("findContact: coincide con la variante y no con LIDs", () => {
  const contacts = [{ number: "5491134700227" }, { number: "59897117916" }];
  assert.equal(findContact(contacts, ["541134700227"]).number, "5491134700227");
  assert.equal(findContact(contacts, ["59897117916"]).number, "59897117916");
  assert.equal(findContact(contacts, []), undefined);
  assert.equal(findContact(contacts, ["5491100000000"]), undefined);
});
