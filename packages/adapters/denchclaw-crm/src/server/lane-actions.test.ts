import { describe, it, expect } from "vitest";
import { ISSUE_STATUSES, type IssueStatus } from "@paperclipai/shared";
import { LANE_ACTION_TABLE, actionForStatus, ACTION_PROMPTS } from "./lane-actions.js";

describe("lane-actions table", () => {
  it("covers every IssueStatus (no status can fall through undefined)", () => {
    for (const status of ISSUE_STATUSES) {
      expect(Object.prototype.hasOwnProperty.call(LANE_ACTION_TABLE, status)).toBe(true);
    }
    // and no extra keys beyond the real status union
    const tableKeys = Object.keys(LANE_ACTION_TABLE).sort();
    expect(tableKeys).toEqual([...ISSUE_STATUSES].sort());
  });

  it("only dispatches on in_progress / in_review / done in MVP", () => {
    const dispatching = (Object.entries(LANE_ACTION_TABLE) as [IssueStatus, unknown][])
      .filter(([, action]) => action !== null && action !== "ARCHIVE")
      .map(([s]) => s)
      .sort();
    expect(dispatching).toEqual(["done", "in_progress", "in_review"]);
  });

  it("never dispatches agent work for backlog/todo/blocked (signal-only)", () => {
    for (const s of ["backlog", "todo", "blocked"] as IssueStatus[]) {
      expect(actionForStatus(s)).toBeNull();
    }
  });

  it("maps cancelled to ARCHIVE (no agent dispatch)", () => {
    expect(actionForStatus("cancelled")).toBe("ARCHIVE");
  });

  it("has a prompt for every dispatching action", () => {
    for (const action of ["RESEARCH_CONTACT", "DRAFT_OUTREACH", "SUMMARIZE_AND_UPDATE"] as const) {
      expect(typeof ACTION_PROMPTS[action]).toBe("string");
      expect(ACTION_PROMPTS[action].length).toBeGreaterThan(0);
    }
  });
});
