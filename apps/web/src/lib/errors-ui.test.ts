/**
 * lib/errors-ui — the one path that renders every unmapped server rejection.
 *
 * F-38: a single-field validation failure used to be prefixed with
 * `errFieldRequired` ("এটি পূরণ করুন / This field is required"), so the generic
 * path produced contradictions — a password rejected for its length read as
 * "This field is required: password is too short". The prefix is gone, and the
 * message-mapper's rule order is specific-before-generic (length/format before
 * "required"), which these tests lock in both directions.
 */
import { describe, it, expect } from "vitest";
import { ApiError } from "./api";
import { mapError } from "./errors-ui";
import { dict } from "./i18n";

/** The distinctive words of a dictionary sentence, with its {label} removed. */
function withoutLabel(template: string): string {
  return template.replace("{label}", "").trim();
}

const REQUIRED_WORD = dict.errFieldRequired.bn; // "এই ঘরটি পূরণ করুন।" — the retired prefix
const TOO_SHORT_WORD = withoutLabel(dict.errValidationTooShort.bn);
const REQUIRED_RULE_WORD = withoutLabel(dict.errValidationRequired.bn);

function validation(details: Array<{ field?: string; message?: string }>): ApiError {
  return new ApiError(400, "VALIDATION_ERROR", "Validation failed", details);
}

describe("lib/errors-ui — single-field validation copy (F-38)", () => {
  it("reports a too-short password as too short, never as a missing field", () => {
    const msg = mapError(validation([{ field: "password", message: "String must contain at least 8 character(s)" }]), "bn");

    expect(msg).toContain(TOO_SHORT_WORD); // "খুব ছোট"
    expect(msg).toContain("পাসওয়ার্ড"); // the field's own label
    expect(msg).not.toContain(REQUIRED_WORD); // the retired "This field is required" prefix
  });

  it("still says a genuinely missing field is required", () => {
    const msg = mapError(validation([{ field: "phone", message: "Required" }]), "bn");

    expect(msg).toContain(REQUIRED_RULE_WORD); // "প্রয়োজন"
    expect(msg).toContain("মোবাইল নম্বর");
    expect(msg).not.toContain(REQUIRED_WORD);
  });

  it("lists every field once when several fail, without the prefix", () => {
    const msg = mapError(
      validation([
        { field: "phone", message: "Invalid phone number" },
        { field: "password", message: "String must contain at least 8 character(s)" },
      ]),
      "bn"
    );

    expect(msg).toContain("মোবাইল নম্বর");
    expect(msg).toContain("পাসওয়ার্ড");
    expect(msg).toContain(" · "); // the multi-field separator
    expect(msg).not.toContain(REQUIRED_WORD);
  });

  it("passes an unmapped server message through unchanged (backend domain copy wins)", () => {
    const msg = mapError(validation([{ field: "plotId", message: "এই প্লটে ইতিমধ্যে একটি সক্রিয় ফসল আছে।" }]), "bn");
    expect(msg).toBe("এই প্লটে ইতিমধ্যে একটি সক্রিয় ফসল আছে।");
  });
});
