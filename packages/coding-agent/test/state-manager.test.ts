import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StateManager } from "../src/core/state-manager.js";

describe("StateManager", () => {
	const testDir = join(process.cwd(), "test-state-tmp");
	const agentDir = join(testDir, "agent");
	const projectDir = join(testDir, "project");

	beforeEach(() => {
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true });
		}
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(join(projectDir, ".pi"), { recursive: true });
	});

	afterEach(() => {
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true });
		}
	});

	describe("persistence", () => {
		it("should persist lastProvider and lastModelId to state.json", async () => {
			const manager = StateManager.create(projectDir, agentDir);
			manager.setLastProviderAndModel("anthropic", "claude-sonnet-4-5");
			await manager.flush();

			const statePath = join(agentDir, "state.json");
			expect(existsSync(statePath)).toBe(true);

			const saved = JSON.parse(readFileSync(statePath, "utf-8"));
			expect(saved.lastProvider).toBe("anthropic");
			expect(saved.lastModelId).toBe("claude-sonnet-4-5");
		});

		it("should persist lastThinkingLevel to state.json", async () => {
			const manager = StateManager.create(projectDir, agentDir);
			manager.setLastThinkingLevel("high");
			await manager.flush();

			const statePath = join(agentDir, "state.json");
			const saved = JSON.parse(readFileSync(statePath, "utf-8"));
			expect(saved.lastThinkingLevel).toBe("high");
		});

		it("should persist lastChangelogVersion to state.json", async () => {
			const manager = StateManager.create(projectDir, agentDir);
			manager.setLastChangelogVersion("0.67.1");
			await manager.flush();

			const statePath = join(agentDir, "state.json");
			const saved = JSON.parse(readFileSync(statePath, "utf-8"));
			expect(saved.lastChangelogVersion).toBe("0.67.1");
		});

		it("should preserve externally added state fields when updating", async () => {
			const statePath = join(agentDir, "state.json");
			writeFileSync(statePath, JSON.stringify({ lastProvider: "openai" }));

			const manager = StateManager.create(projectDir, agentDir);
			manager.setLastThinkingLevel("medium");
			await manager.flush();

			const saved = JSON.parse(readFileSync(statePath, "utf-8"));
			expect(saved.lastProvider).toBe("openai");
			expect(saved.lastThinkingLevel).toBe("medium");
		});

		it("should not create state.json when only reading", () => {
			const manager = StateManager.create(projectDir, agentDir);
			expect(manager.getLastProvider()).toBeUndefined();
			expect(existsSync(join(agentDir, "state.json"))).toBe(false);
		});
	});

	describe("resolution", () => {
		it("should return values from both global and project state", () => {
			// Create project state that overrides global
			const projectStatePath = join(projectDir, ".pi", "state.json");
			writeFileSync(projectStatePath, JSON.stringify({ lastProvider: "project-provider" }));

			const manager = StateManager.create(projectDir, agentDir);
			// Project state overrides global
			expect(manager.getLastProvider()).toBe("project-provider");
		});

		it("should fall back to global state when project has no override", () => {
			const globalStatePath = join(agentDir, "state.json");
			writeFileSync(globalStatePath, JSON.stringify({ lastModelId: "global-model" }));

			const manager = StateManager.create(projectDir, agentDir);
			expect(manager.getLastModelId()).toBe("global-model");
		});
	});

	describe("inMemory", () => {
		it("should create an in-memory StateManager", () => {
			const manager = StateManager.inMemory({ lastProvider: "test" });
			expect(manager.getLastProvider()).toBe("test");
		});

		it("should support setLastProviderAndModel", () => {
			const manager = StateManager.inMemory();
			manager.setLastProviderAndModel("anthropic", "claude-opus-4-5");
			expect(manager.getLastProvider()).toBe("anthropic");
			expect(manager.getLastModelId()).toBe("claude-opus-4-5");
		});
	});

	describe("reload", () => {
		it("should reload global state from disk", async () => {
			const statePath = join(agentDir, "state.json");
			writeFileSync(statePath, JSON.stringify({ lastProvider: "before" }));

			const manager = StateManager.create(projectDir, agentDir);
			expect(manager.getLastProvider()).toBe("before");

			writeFileSync(statePath, JSON.stringify({ lastProvider: "after", lastModelId: "new-model" }));
			await manager.reload();

			expect(manager.getLastProvider()).toBe("after");
			expect(manager.getLastModelId()).toBe("new-model");
		});

		it("should keep previous state when file is invalid", async () => {
			const statePath = join(agentDir, "state.json");
			writeFileSync(statePath, JSON.stringify({ lastProvider: "before" }));

			const manager = StateManager.create(projectDir, agentDir);

			writeFileSync(statePath, "{ invalid json");
			await manager.reload();

			expect(manager.getLastProvider()).toBe("before");
		});
	});
});
