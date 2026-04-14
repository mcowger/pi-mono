import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { CONFIG_DIR_NAME, getAgentDir } from "../config.js";
import { FileSettingsStorage, InMemorySettingsStorage } from "./settings-manager.js";

/**
 * Application state that changes automatically based on user interaction.
 * Stored in state.json separately from settings.json because these values
 * represent "last used" state, not user-configured preferences.
 *
 * Resolution priority: last* (state) > default* (settings) > built-in fallback
 */
export interface AppState {
	lastProvider?: string;
	lastModelId?: string;
	lastThinkingLevel?: ThinkingLevel;
	lastChangelogVersion?: string;
}

/**
 * Manages application state persisted to state.json.
 *
 * Reuses FileSettingsStorage for file locking, directory creation, and
 * read/write mechanics. StateManager provides its own interface and
 * file paths, keeping state completely separate from settings.
 */
export class StateManager {
	private storage: FileSettingsStorage | InMemorySettingsStorage;
	private globalState: AppState;
	private projectState: AppState;
	private state: AppState;
	private modifiedFields = new Set<keyof AppState>();
	private writeQueue: Promise<void> = Promise.resolve();
	private globalPath: string;
	private projectPath: string;

	constructor(
		storage: FileSettingsStorage | InMemorySettingsStorage,
		initialGlobal: AppState,
		initialProject: AppState,
		globalPath: string,
		projectPath: string,
	) {
		this.storage = storage;
		this.globalState = initialGlobal;
		this.projectState = initialProject;
		this.globalPath = globalPath;
		this.projectPath = projectPath;
		this.state = { ...this.globalState, ...this.projectState };
	}

	/** Create a StateManager that loads from state.json files */
	static create(cwd: string = process.cwd(), agentDir: string = getAgentDir()): StateManager {
		const globalPath = join(agentDir, "state.json");
		const projectPath = join(cwd, CONFIG_DIR_NAME, "state.json");
		const storage = new FileSettingsStorage(cwd, agentDir, "state.json");

		// Load initial state from disk — invalid content is treated as empty
		const globalState = StateManager.loadFromPathOrEmpty(globalPath);
		const projectState = StateManager.loadFromPathOrEmpty(projectPath);
		return new StateManager(storage, globalState, projectState, globalPath, projectPath);
	}

	/** Create an in-memory StateManager (no file I/O) */
	static inMemory(initial: Partial<AppState> = {}): StateManager {
		const storage = new InMemorySettingsStorage();
		return new StateManager(storage, { ...initial }, {}, "", "");
	}

	private static loadFromPathOrEmpty(path: string): AppState {
		if (!existsSync(path)) return {};
		try {
			return JSON.parse(readFileSync(path, "utf-8")) as AppState;
		} catch {
			return {};
		}
	}

	private loadFromPathPreserving(path: string): AppState {
		if (!existsSync(path)) return {};
		try {
			return JSON.parse(readFileSync(path, "utf-8")) as AppState;
		} catch {
			// File exists but is invalid — keep current state
			return undefined as unknown as AppState;
		}
	}

	async reload(): Promise<void> {
		await this.writeQueue;
		const newGlobal = this.loadFromPathPreserving(this.globalPath);
		const newProject = this.loadFromPathPreserving(this.projectPath);
		if (newGlobal) this.globalState = newGlobal;
		if (newProject) this.projectState = newProject;
		this.state = { ...this.globalState, ...this.projectState };
	}

	async flush(): Promise<void> {
		await this.writeQueue;
	}

	private save(): void {
		this.state = { ...this.globalState, ...this.projectState };

		const snapshot = structuredClone(this.globalState);
		const fields = new Set(this.modifiedFields);
		this.modifiedFields.clear();

		const globalPath = this.globalPath;
		this.writeQueue = this.writeQueue
			.then(() => {
				this.storage.withLock(
					"global",
					(current) => {
						const existing = current ? JSON.parse(current) : {};
						for (const key of fields) {
							const value = snapshot[key];
							if (value !== undefined) {
								(existing as Record<string, unknown>)[key] = value;
							} else {
								delete (existing as Record<string, unknown>)[key];
							}
						}
						return JSON.stringify(existing, null, 2);
					},
					globalPath,
				);
			})
			.catch(() => {
				// Silently ignore write errors in StateManager (non-critical)
			});
	}

	// =========================================================================
	// Last Provider
	// =========================================================================

	getLastProvider(): string | undefined {
		return this.state.lastProvider;
	}

	setLastProvider(provider: string): void {
		this.globalState.lastProvider = provider;
		this.modifiedFields.add("lastProvider");
		this.save();
	}

	// =========================================================================
	// Last Model ID
	// =========================================================================

	getLastModelId(): string | undefined {
		return this.state.lastModelId;
	}

	setLastModelId(modelId: string): void {
		this.globalState.lastModelId = modelId;
		this.modifiedFields.add("lastModelId");
		this.save();
	}

	/**
	 * Set both last provider and last model ID in a single write.
	 */
	setLastProviderAndModel(provider: string, modelId: string): void {
		this.globalState.lastProvider = provider;
		this.globalState.lastModelId = modelId;
		this.modifiedFields.add("lastProvider");
		this.modifiedFields.add("lastModelId");
		this.save();
	}

	// =========================================================================
	// Last Thinking Level
	// =========================================================================

	getLastThinkingLevel(): ThinkingLevel | undefined {
		return this.state.lastThinkingLevel;
	}

	setLastThinkingLevel(level: ThinkingLevel): void {
		this.globalState.lastThinkingLevel = level;
		this.modifiedFields.add("lastThinkingLevel");
		this.save();
	}

	// =========================================================================
	// Last Changelog Version
	// =========================================================================

	getLastChangelogVersion(): string | undefined {
		return this.state.lastChangelogVersion;
	}

	setLastChangelogVersion(version: string): void {
		this.globalState.lastChangelogVersion = version;
		this.modifiedFields.add("lastChangelogVersion");
		this.save();
	}
}
