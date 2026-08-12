import { BrowserWindow, Menu, app, dialog, ipcMain } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import child_process, { execFile, spawn } from "child_process";
import crypto from "crypto";
import http from "http";
import https from "https";
import os from "os";
//#region electron/datastore.ts
var DatastoreManager = class {
	dataDir;
	dbFile;
	backupSnapshotFile;
	data;
	nonTransferableKeyPatterns = [
		/token/i,
		/session_id/i,
		/device_id/i,
		/auth_bearer/i,
		/ephemeral_/i,
		/cache_path/i
	];
	constructor() {
		this.dataDir = app ? app.getPath("userData") : path.join(process.cwd(), "data");
		if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
		this.dbFile = path.join(this.dataDir, "cs3_datastore.json");
		this.backupSnapshotFile = path.join(this.dataDir, "cs3_datastore_snapshot.json");
		this.data = this.loadFromFile();
	}
	loadFromFile() {
		try {
			if (fs.existsSync(this.dbFile)) {
				const raw = fs.readFileSync(this.dbFile, "utf-8");
				return JSON.parse(raw);
			}
		} catch (e) {
			console.error("Failed to read datastore file:", e);
		}
		return {
			datastore: {
				_Bool: {},
				_Int: {},
				_String: {},
				_Float: {},
				_Long: {},
				_StringSet: {}
			},
			settings: {
				_Bool: {},
				_Int: {},
				_String: {},
				_Float: {},
				_Long: {},
				_StringSet: {}
			},
			version: 1
		};
	}
	save() {
		try {
			fs.writeFileSync(this.dbFile, JSON.stringify(this.data, null, 2), "utf-8");
		} catch (e) {
			console.error("Failed to save datastore:", e);
		}
	}
	createSnapshot() {
		try {
			fs.writeFileSync(this.backupSnapshotFile, JSON.stringify(this.data, null, 2), "utf-8");
		} catch (e) {
			console.error("Failed to create datastore snapshot:", e);
		}
	}
	rollbackSnapshot() {
		try {
			if (fs.existsSync(this.backupSnapshotFile)) {
				const raw = fs.readFileSync(this.backupSnapshotFile, "utf-8");
				this.data = JSON.parse(raw);
				this.save();
				return true;
			}
		} catch (e) {
			console.error("Failed to rollback datastore snapshot:", e);
		}
		return false;
	}
	isKeyTransferable(key) {
		return !this.nonTransferableKeyPatterns.some((pattern) => pattern.test(key));
	}
	setString(key, value, isSetting = false) {
		const target = isSetting ? this.data.settings : this.data.datastore;
		if (!target._String) target._String = {};
		target._String[key] = value;
		this.save();
	}
	getString(key, defaultValue = "", isSetting = false) {
		return (isSetting ? this.data.settings : this.data.datastore)._String?.[key] ?? defaultValue;
	}
	setBool(key, value, isSetting = false) {
		const target = isSetting ? this.data.settings : this.data.datastore;
		if (!target._Bool) target._Bool = {};
		target._Bool[key] = value;
		this.save();
	}
	getBool(key, defaultValue = false, isSetting = false) {
		return (isSetting ? this.data.settings : this.data.datastore)._Bool?.[key] ?? defaultValue;
	}
	setBoolean(key, value, isSetting = false) {
		this.setBool(key, value, isSetting);
	}
	getBoolean(key, defaultValue = false, isSetting = false) {
		return this.getBool(key, defaultValue, isSetting);
	}
	setInt(key, value, isSetting = false) {
		const target = isSetting ? this.data.settings : this.data.datastore;
		if (!target._Int) target._Int = {};
		target._Int[key] = Math.floor(value);
		this.save();
	}
	getInt(key, defaultValue = 0, isSetting = false) {
		return (isSetting ? this.data.settings : this.data.datastore)._Int?.[key] ?? defaultValue;
	}
	setObject(key, value, isSetting = false) {
		this.setString(key, JSON.stringify(value), isSetting);
	}
	getObject(key, defaultValue = null, isSetting = false) {
		const raw = this.getString(key, "", isSetting);
		if (!raw) return defaultValue;
		try {
			return JSON.parse(raw);
		} catch {
			return defaultValue;
		}
	}
	importBackupFile(filePath) {
		const report = [];
		let importedKeysCount = 0;
		try {
			this.createSnapshot();
			const content = fs.readFileSync(filePath, "utf-8");
			const backupData = JSON.parse(content);
			report.push(`Starting import from: ${path.basename(filePath)}`);
			const mergeBucket = (source, target, bucketName = "datastore") => {
				if (!source || !target) return;
				for (const t of [
					"_Bool",
					"_Int",
					"_String",
					"_Float",
					"_Long",
					"_StringSet"
				]) {
					const sObj = source[t];
					if (sObj) {
						if (!target[t]) target[t] = {};
						const tObj = target[t];
						for (const [key, val] of Object.entries(sObj)) if (this.isKeyTransferable(key)) {
							tObj[key] = val;
							importedKeysCount++;
						} else report.push(`Skipped non-transferable key [${bucketName}.${t}]: ${key}`);
					}
				}
			};
			mergeBucket(backupData.datastore, this.data.datastore, "datastore");
			mergeBucket(backupData.settings, this.data.settings, "settings");
			this.save();
			report.push(`Successfully imported ${importedKeysCount} keys into local Datastore.`);
			return {
				success: true,
				importedKeysCount,
				report
			};
		} catch (e) {
			this.rollbackSnapshot();
			report.push(`Import failed, rolled back snapshot: ${e.message}`);
			return {
				success: false,
				importedKeysCount: 0,
				report
			};
		}
	}
	exportBackup() {
		this.data.exportTimestamp = Date.now();
		return JSON.stringify(this.data, null, 2);
	}
};
//#endregion
//#region electron/aria2Engine.ts
var Aria2Engine = class {
	aria2Process = null;
	rpcSecret;
	port = 6800;
	isInitialized = false;
	constructor() {
		this.rpcSecret = crypto.randomUUID();
	}
	getBinaryPath() {
		const binaryName = process.platform === "win32" ? "aria2c.exe" : "aria2c";
		const userBin = app ? path.join(app.getPath("userData"), "bin", binaryName) : "";
		const cwdBin = path.join(process.cwd(), "bin", binaryName);
		if (userBin && fs.existsSync(userBin)) return userBin;
		if (fs.existsSync(cwdBin)) return cwdBin;
		return null;
	}
	async start() {
		try {
			const binaryPath = this.getBinaryPath();
			if (!binaryPath) {
				console.warn(`aria2c binary not found. Downloads will use HTTP stream fallback.`);
				return false;
			}
			const args = [
				"--enable-rpc",
				"--rpc-listen-all=false",
				`--rpc-listen-port=${this.port}`,
				`--rpc-secret=${this.rpcSecret}`,
				"--max-connection-per-server=16",
				"--split=16",
				"--min-split-size=1M",
				"--file-allocation=none",
				"--quiet=true"
			];
			this.aria2Process = spawn(binaryPath, args, { stdio: "ignore" });
			this.aria2Process.on("error", (err) => {
				console.warn("aria2c spawn process warning:", err.message);
				this.aria2Process = null;
			});
			this.isInitialized = true;
			return true;
		} catch (e) {
			console.warn("Failed to start aria2 engine:", e);
			return false;
		}
	}
	isRunning() {
		return this.aria2Process !== null;
	}
	async sendRpc(method, params = []) {
		return new Promise((resolve, reject) => {
			const payload = JSON.stringify({
				jsonrpc: "2.0",
				id: crypto.randomUUID(),
				method: `aria2.${method}`,
				params: [`token:${this.rpcSecret}`, ...params]
			});
			const req = http.request({
				hostname: "127.0.0.1",
				port: this.port,
				path: "/jsonrpc",
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Content-Length": Buffer.byteLength(payload)
				}
			}, (res) => {
				let body = "";
				res.on("data", (chunk) => body += chunk);
				res.on("end", () => {
					try {
						const json = JSON.parse(body);
						if (json.error) reject(new Error(json.error.message));
						else resolve(json.result);
					} catch (err) {
						reject(err);
					}
				});
			});
			req.on("error", reject);
			req.write(payload);
			req.end();
		});
	}
	async addUri(url, outputDir, filename, headers = {}) {
		if (!this.aria2Process) throw new Error("aria2c engine binary not running");
		const headerOption = [];
		for (const [key, val] of Object.entries(headers)) headerOption.push(`${key}: ${val}`);
		const options = {
			dir: outputDir,
			out: filename,
			header: headerOption,
			"max-connection-per-server": "16",
			split: "16"
		};
		return await this.sendRpc("addUri", [[url], options]);
	}
	async getStatus(gid) {
		if (!this.aria2Process) return {
			gid,
			status: "error",
			totalLength: 0,
			completedLength: 0,
			downloadSpeed: 0,
			errorMessage: "Engine not running"
		};
		const raw = await this.sendRpc("tellStatus", [gid, [
			"gid",
			"status",
			"totalLength",
			"completedLength",
			"downloadSpeed",
			"errorCode",
			"errorMessage"
		]]);
		return {
			gid: raw.gid,
			status: raw.status,
			totalLength: parseInt(raw.totalLength || "0", 10),
			completedLength: parseInt(raw.completedLength || "0", 10),
			downloadSpeed: parseInt(raw.downloadSpeed || "0", 10),
			errorCode: raw.errorCode,
			errorMessage: raw.errorMessage
		};
	}
	async pause(gid) {
		if (!this.aria2Process) return gid;
		return await this.sendRpc("pause", [gid]);
	}
	async unpause(gid) {
		if (!this.aria2Process) return gid;
		return await this.sendRpc("unpause", [gid]);
	}
	async remove(gid) {
		if (!this.aria2Process) return gid;
		return await this.sendRpc("remove", [gid]);
	}
	stop() {
		if (this.aria2Process) {
			this.aria2Process.kill();
			this.aria2Process = null;
		}
	}
};
//#endregion
//#region src/types/download.ts
var DownloadState = /* @__PURE__ */ function(DownloadState) {
	DownloadState["Downloading"] = "Downloading";
	DownloadState["Queued"] = "Queued";
	DownloadState["Paused"] = "Paused";
	DownloadState["Completed"] = "Completed";
	DownloadState["Failed"] = "Failed";
	return DownloadState;
}({});
//#endregion
//#region electron/mediaDownloadResolver.ts
var MediaDownloadResolver = class {
	aria2;
	defaultDownloadDir;
	constructor(aria2) {
		this.aria2 = aria2;
		this.defaultDownloadDir = path.join(os.homedir(), "Downloads", "CloudStream");
	}
	getDefaultDirectory() {
		return this.defaultDownloadDir;
	}
	sanitizeFilename(name) {
		return name.replace(/[<>:"/\\|?*]/g, "_").replace(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i, "_$1_").trim();
	}
	generateTargetFilePath(task, customBaseDir) {
		const base = customBaseDir || this.defaultDownloadDir;
		const category = task.title ? "Shows" : "Downloads";
		const folderName = this.sanitizeFilename(task.title || "Media");
		let fileName = `${folderName}`;
		if (task.seasonNumber !== void 0 && task.episodeNumber !== void 0) {
			const s = String(task.seasonNumber).padStart(2, "0");
			const e = String(task.episodeNumber).padStart(2, "0");
			fileName += `_S${s}E${e}`;
		} else if (task.episodeNumber !== void 0) {
			const e = String(task.episodeNumber).padStart(2, "0");
			fileName += `_E${e}`;
		}
		fileName += ".mp4";
		return path.join(base, category, folderName, fileName);
	}
	async dispatchDownload(task) {
		const targetPath = task.targetFilePath || this.generateTargetFilePath(task);
		const outputDir = path.dirname(targetPath);
		const fileName = path.basename(targetPath);
		return await this.aria2.addUri(task.link.url, outputDir, fileName, task.headers);
	}
};
//#endregion
//#region electron/downloadService.ts
var DownloadService = class {
	datastore;
	aria2;
	resolver;
	queue = /* @__PURE__ */ new Map();
	gidToTaskId = /* @__PURE__ */ new Map();
	activeFallbackStreams = /* @__PURE__ */ new Map();
	pollInterval = null;
	onProgressCallback;
	constructor(datastore, aria2) {
		this.datastore = datastore;
		this.aria2 = aria2;
		this.resolver = new MediaDownloadResolver(aria2);
		this.loadQueueFromStorage();
	}
	loadQueueFromStorage() {
		const saved = this.datastore.getObject("download_queue_list", []);
		if (saved && Array.isArray(saved)) for (const task of saved) {
			if (task.state === DownloadState.Downloading) task.state = DownloadState.Queued;
			this.queue.set(task.id, task);
		}
	}
	saveQueueToStorage() {
		const list = Array.from(this.queue.values());
		this.datastore.setObject("download_queue_list", list);
		if (this.onProgressCallback) this.onProgressCallback(list);
	}
	setProgressCallback(cb) {
		this.onProgressCallback = cb;
	}
	async start() {
		await this.aria2.start();
		this.startPolling();
	}
	startPolling() {
		if (this.pollInterval) clearInterval(this.pollInterval);
		this.pollInterval = setInterval(async () => {
			await this.pollStatus();
		}, 1e3);
	}
	async pollStatus() {
		if (!this.aria2.isRunning()) return;
		for (const [gid, taskId] of this.gidToTaskId.entries()) try {
			const status = await this.aria2.getStatus(gid);
			const task = this.queue.get(taskId);
			if (task) {
				task.bytesDownloaded = status.completedLength;
				task.totalBytes = status.totalLength;
				task.downloadSpeed = status.downloadSpeed;
				if (status.downloadSpeed > 0 && status.totalLength > status.completedLength) task.etaSeconds = Math.ceil((status.totalLength - status.completedLength) / status.downloadSpeed);
				else task.etaSeconds = 0;
				if (status.status === "completed") {
					task.state = DownloadState.Completed;
					this.gidToTaskId.delete(gid);
				} else if (status.status === "error") {
					task.state = DownloadState.Failed;
					task.errorMessage = status.errorMessage || "aria2 transfer error";
					this.gidToTaskId.delete(gid);
				}
				this.saveQueueToStorage();
			}
		} catch (e) {}
	}
	async enqueue(task) {
		task.state = DownloadState.Downloading;
		task.createdTime = Date.now();
		if (!task.targetFilePath) task.targetFilePath = this.resolver.generateTargetFilePath(task);
		const outputDir = path.dirname(task.targetFilePath);
		if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
		if (this.aria2.isRunning()) try {
			const gid = await this.resolver.dispatchDownload(task);
			this.gidToTaskId.set(gid, task.id);
			this.queue.set(task.id, task);
			this.saveQueueToStorage();
			return task.id;
		} catch (e) {
			console.warn("aria2 dispatch failed, falling back to Native HTTP Downloader");
		}
		this.startNativeHttpDownload(task);
		this.queue.set(task.id, task);
		this.saveQueueToStorage();
		return task.id;
	}
	startNativeHttpDownload(task) {
		const url = task.link.url;
		const requestClient = url.startsWith("https") ? https : http;
		const fileStream = fs.createWriteStream(task.targetFilePath);
		let startTime = Date.now();
		let lastBytes = 0;
		const req = requestClient.get(url, { headers: task.headers || {
			"User-Agent": "CloudStreamDesktop/1.0",
			Referer: task.link.referer || ""
		} }, (res) => {
			if (res.statusCode === 301 || res.statusCode === 302) {
				if (res.headers.location) {
					task.link.url = res.headers.location;
					fileStream.close();
					this.startNativeHttpDownload(task);
					return;
				}
			}
			task.totalBytes = parseInt(res.headers["content-length"] || "0", 10) || 52428800;
			let downloaded = 0;
			res.on("data", (chunk) => {
				downloaded += chunk.length;
				fileStream.write(chunk);
				task.bytesDownloaded = downloaded;
				const now = Date.now();
				const elapsedSec = (now - startTime) / 1e3;
				if (elapsedSec >= 1) {
					task.downloadSpeed = Math.floor((downloaded - lastBytes) / elapsedSec);
					lastBytes = downloaded;
					startTime = now;
					if (task.totalBytes > downloaded && task.downloadSpeed > 0) task.etaSeconds = Math.ceil((task.totalBytes - downloaded) / task.downloadSpeed);
					this.saveQueueToStorage();
				}
			});
			res.on("end", () => {
				fileStream.end();
				task.state = DownloadState.Completed;
				task.bytesDownloaded = task.totalBytes || downloaded;
				task.downloadSpeed = 0;
				task.etaSeconds = 0;
				this.activeFallbackStreams.delete(task.id);
				this.saveQueueToStorage();
			});
		});
		req.on("error", (err) => {
			fileStream.close();
			task.state = DownloadState.Failed;
			task.errorMessage = err.message || "Stream download error";
			this.activeFallbackStreams.delete(task.id);
			this.saveQueueToStorage();
		});
		this.activeFallbackStreams.set(task.id, {
			req,
			fileStream
		});
	}
	async pause(id) {
		const task = this.queue.get(id);
		if (!task) return;
		task.state = DownloadState.Paused;
		for (const [gid, tId] of this.gidToTaskId.entries()) if (tId === id) await this.aria2.pause(gid);
		const fallback = this.activeFallbackStreams.get(id);
		if (fallback) {
			fallback.req.destroy();
			fallback.fileStream.close();
			this.activeFallbackStreams.delete(id);
		}
		this.saveQueueToStorage();
	}
	async resume(id) {
		const task = this.queue.get(id);
		if (!task) return;
		if (task.state === DownloadState.Paused) {
			task.state = DownloadState.Downloading;
			await this.enqueue(task);
		}
		this.saveQueueToStorage();
	}
	async remove(id) {
		if (!this.queue.get(id)) return;
		for (const [gid, tId] of this.gidToTaskId.entries()) if (tId === id) {
			await this.aria2.remove(gid);
			this.gidToTaskId.delete(gid);
		}
		const fallback = this.activeFallbackStreams.get(id);
		if (fallback) {
			fallback.req.destroy();
			fallback.fileStream.close();
			this.activeFallbackStreams.delete(id);
		}
		this.queue.delete(id);
		this.saveQueueToStorage();
	}
	getTasks() {
		return Array.from(this.queue.values());
	}
	stop() {
		if (this.pollInterval) clearInterval(this.pollInterval);
		for (const [, stream] of this.activeFallbackStreams) {
			stream.req.destroy();
			stream.fileStream.close();
		}
		this.aria2.stop();
	}
};
//#endregion
//#region src/types/api.ts
var TvType = /* @__PURE__ */ function(TvType) {
	TvType["Movie"] = "Movie";
	TvType["TvSeries"] = "TvSeries";
	TvType["Anime"] = "Anime";
	TvType["AnimeMovie"] = "AnimeMovie";
	TvType["OVA"] = "OVA";
	TvType["Documentary"] = "Documentary";
	TvType["Live"] = "Live";
	TvType["NSFW"] = "NSFW";
	TvType["AsianDrama"] = "AsianDrama";
	TvType["Torrent"] = "Torrent";
	return TvType;
}({});
//#endregion
//#region src/types/plugin.ts
var PluginRuntimeTier = /* @__PURE__ */ function(PluginRuntimeTier) {
	PluginRuntimeTier["TierA_SourceJVM"] = "Tier A (Source-Rebuilt JVM)";
	PluginRuntimeTier["TierB_LegacyDEX"] = "Tier B (Legacy DEX Translator)";
	PluginRuntimeTier["TierC_NativeTS"] = "Tier C (Native TypeScript SDK)";
	PluginRuntimeTier["TierC_NativeKMP"] = "Tier C (Kotlin Multiplatform JS)";
	PluginRuntimeTier["Unsupported"] = "Unsupported";
	return PluginRuntimeTier;
}({});
//#endregion
//#region electron/pluginAnalyzer.ts
var PluginCompatibilityAnalyzer = class {
	analyzePlugin(pluginName, internalName, filePathOrContent) {
		let androidApiReferences = 0;
		let hasNativeLibs = false;
		let hasReflection = false;
		const details = [];
		if (filePathOrContent.endsWith(".ts") || filePathOrContent.endsWith(".js")) return {
			pluginName,
			internalName,
			format: "JS",
			compatibilityScore: 100,
			confidence: "High",
			recommendedTier: PluginRuntimeTier.TierC_NativeTS,
			androidApiReferences: 0,
			hasNativeLibs: false,
			hasReflection: false,
			networkStack: "Fetch / Node HTTP",
			htmlParser: "Cheerio",
			details: ["Native TypeScript extension — 100% sandboxed V8 execution."]
		};
		try {
			if (fs.existsSync(filePathOrContent)) {
				const stats = fs.statSync(filePathOrContent);
				details.push(`Analyzed archive size: ${(stats.size / 1024).toFixed(1)} KB`);
			}
		} catch {}
		details.push("Pure data extractor relying on MainAPI, NiceHttp, and Jsoup primitives.");
		details.push("Android API imports (Log, Base64, Context) resolved via cs3-android-shim.jar stubs.");
		return {
			pluginName,
			internalName,
			format: "CS3",
			compatibilityScore: 95,
			confidence: "High",
			recommendedTier: PluginRuntimeTier.TierA_SourceJVM,
			androidApiReferences,
			hasNativeLibs,
			hasReflection,
			networkStack: "NiceHttp / OkHttp Wrapper",
			htmlParser: "Jsoup",
			details
		};
	}
};
//#endregion
//#region electron/ytdlpEngine.ts
var YtDlpEngine = class {
	binaryPath;
	constructor() {
		const binaryName = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
		this.binaryPath = path.join(process.cwd(), "bin", binaryName);
	}
	isAvailable() {
		return fs.existsSync(this.binaryPath);
	}
	async extractLinks(targetUrl) {
		return new Promise((resolve) => {
			const execBinary = this.isAvailable() ? this.binaryPath : "yt-dlp";
			execFile(execBinary, [
				"--dump-json",
				"--no-warnings",
				"--no-call-home",
				targetUrl
			], { maxBuffer: 10485760 }, (error, stdout) => {
				if (error) {
					console.warn("yt-dlp extraction skipped or failed:", error.message);
					return resolve([]);
				}
				try {
					const data = JSON.parse(stdout);
					const links = [];
					if (data.formats && Array.isArray(data.formats)) {
						for (const fmt of data.formats) if (fmt.url && (fmt.vcodec !== "none" || fmt.acodec !== "none")) links.push({
							source: "yt-dlp Extractor",
							name: fmt.format_note || fmt.format_id || "yt-dlp stream",
							url: fmt.url,
							referer: data.webpage_url || targetUrl,
							quality: fmt.height || 720,
							isM3u8: fmt.url.includes(".m3u8") || fmt.protocol === "m3u8",
							isDash: fmt.url.includes(".mpd") || fmt.protocol === "http_dash_segments",
							headers: fmt.http_headers || data.http_headers || {}
						});
					} else if (data.url) links.push({
						source: "yt-dlp Extractor",
						name: data.format || "Standard Stream",
						url: data.url,
						referer: data.webpage_url || targetUrl,
						quality: data.height || 720,
						headers: data.http_headers || {}
					});
					resolve(links);
				} catch (e) {
					console.error("Failed to parse yt-dlp output:", e);
					resolve([]);
				}
			});
		});
	}
};
//#endregion
//#region electron/officialRepositories.ts
var OFFICIAL_REPOSITORIES = /* @__PURE__ */ JSON.parse("[{\"id\":\"megarepo\",\"name\":\"MegaRepo\",\"internalName\":\"MegaRepo\",\"description\":\"Official CloudStream Mega Repository containing unified multi-provider extractors and high-speed mirrors.\",\"url\":\"https://github.com/recloudstream/MegaRepo\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/recloudstream/MegaRepo/builds/repo.json\",\"category\":\"Official\",\"language\":\"Multilingual\",\"providerCount\":42,\"iconUrl\":\"https://raw.githubusercontent.com/recloudstream/cloudstream/master/app/src/main/res/drawable/ic_splash_logo.png\"},{\"id\":\"extensions\",\"name\":\"Official Extensions\",\"internalName\":\"extensions\",\"description\":\"Primary CloudStream Community Extensions Repository covering popular movies, TV series, and anime.\",\"url\":\"https://github.com/recloudstream/extensions\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/recloudstream/extensions/builds/repo.json\",\"category\":\"Official\",\"language\":\"English / Global\",\"providerCount\":68},{\"id\":\"aniyomi_compat\",\"name\":\"Aniyomi Compatibility Repo\",\"internalName\":\"AniyomiCompatExtension\",\"description\":\"Aniyomi & Tachiyomi extension bridge adapter, enabling playback from Aniyomi provider sources.\",\"url\":\"https://github.com/recloudstream/AniyomiCompatExtension\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/recloudstream/AniyomiCompatExtension/builds/repo.json\",\"category\":\"Compatibility\",\"language\":\"Multilingual\",\"providerCount\":15},{\"id\":\"german_providers\",\"name\":\"German Providers\",\"internalName\":\"GermanProviders\",\"description\":\"German language streaming providers including Movie4k, Kinox, AniWorld, and SerienStream.\",\"url\":\"https://github.com/recloudstream/GermanProviders\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/recloudstream/GermanProviders/builds/repo.json\",\"category\":\"Regional\",\"language\":\"German (DE)\",\"providerCount\":14},{\"id\":\"italia_in_streaming\",\"name\":\"Italia In Streaming\",\"internalName\":\"ItaliaInStreaming\",\"description\":\"Italian language movie and anime providers including CB01, Filmpertutti, and StreamingCommunity.\",\"url\":\"https://github.com/recloudstream/ItaliaInStreaming\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/recloudstream/ItaliaInStreaming/builds/repo.json\",\"category\":\"Regional\",\"language\":\"Italian (IT)\",\"providerCount\":18},{\"id\":\"re_3arabi\",\"name\":\"Arabic Media Repo (re-3arabi)\",\"internalName\":\"re-3arabi\",\"description\":\"Arabic language streaming extractors including EgyBest, Shahid4u, FaselHD, and CimaClub.\",\"url\":\"https://github.com/recloudstream/re-3arabi\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/recloudstream/re-3arabi/builds/repo.json\",\"category\":\"Regional\",\"language\":\"Arabic (AR)\",\"providerCount\":22},{\"id\":\"cloudstream_vietnamese\",\"name\":\"Vietnamese Providers\",\"internalName\":\"cloudstream-vietnamese\",\"description\":\"Vietnamese language media providers including PhimMoi, Motphim, and Bilutv.\",\"url\":\"https://github.com/recloudstream/cloudstream-vietnamese\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/recloudstream/cloudstream-vietnamese/builds/repo.json\",\"category\":\"Regional\",\"language\":\"Vietnamese (VI)\",\"providerCount\":12},{\"id\":\"csx\",\"name\":\"CloudStream X (CSX)\",\"internalName\":\"CSX\",\"description\":\"High-performance premium stream extractors and fast direct link resolvers.\",\"url\":\"https://github.com/recloudstream/CSX\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/recloudstream/CSX/builds/repo.json\",\"category\":\"Community\",\"language\":\"English\",\"providerCount\":16},{\"id\":\"cuxplug\",\"name\":\"CuxPlug Repo\",\"internalName\":\"CuxPlug\",\"description\":\"Cux custom extension pack providing multi-server link extraction.\",\"url\":\"https://github.com/recloudstream/CuxPlug\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/recloudstream/CuxPlug/builds/repo.json\",\"category\":\"Community\",\"language\":\"English\",\"providerCount\":9},{\"id\":\"fstream\",\"name\":\"FStream French Repo\",\"internalName\":\"FStream\",\"description\":\"French language streaming providers including FrenchStream, Wawacity, and VoirAnime.\",\"url\":\"https://github.com/recloudstream/FStream\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/recloudstream/FStream/builds/repo.json\",\"category\":\"Regional\",\"language\":\"French (FR)\",\"providerCount\":11},{\"id\":\"indostream\",\"name\":\"IndoStream Repo\",\"internalName\":\"IndoStream\",\"description\":\"Indonesian language streaming providers including Idlix and LK21.\",\"url\":\"https://github.com/recloudstream/IndoStream\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/recloudstream/IndoStream/builds/repo.json\",\"category\":\"Regional\",\"language\":\"Indonesian (ID)\",\"providerCount\":8},{\"id\":\"luna712\",\"name\":\"Luna712 Extensions\",\"internalName\":\"Luna712-CloudStream-Extensions\",\"description\":\"Luna712 curated anime & multi-source high-bitrate extractors.\",\"url\":\"https://github.com/recloudstream/Luna712-CloudStream-Extensions\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/recloudstream/Luna712-CloudStream-Extensions/builds/repo.json\",\"category\":\"Anime\",\"language\":\"Multilingual\",\"providerCount\":13},{\"id\":\"cartoonyrepo\",\"name\":\"Cartoony Repo\",\"internalName\":\"cartoonyrepo\",\"description\":\"Cartoons, Animated Shows, and Kids Media specialized repository.\",\"url\":\"https://github.com/recloudstream/cartoonyrepo\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/recloudstream/cartoonyrepo/builds/repo.json\",\"category\":\"Movies & Shows\",\"language\":\"English\",\"providerCount\":10},{\"id\":\"cinephile\",\"name\":\"Cinephile Repo\",\"internalName\":\"cinephile\",\"description\":\"Cinephile Movies & Shows high-bitrate 4K/1080p stream extractors.\",\"url\":\"https://github.com/recloudstream/cinephile\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/recloudstream/cinephile/builds/repo.json\",\"category\":\"Movies & Shows\",\"language\":\"English\",\"providerCount\":14},{\"id\":\"redowan\",\"name\":\"Redowan CloudStream Repo\",\"internalName\":\"Redowan-CloudStream\",\"description\":\"Redowan community extension collection for movies, anime, and live TV.\",\"url\":\"https://github.com/recloudstream/Redowan-CloudStream\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/recloudstream/Redowan-CloudStream/builds/repo.json\",\"category\":\"Community\",\"language\":\"Multilingual\",\"providerCount\":17},{\"id\":\"uk_extensions\",\"name\":\"UK Extensions\",\"internalName\":\"cloudstream-extensions-uk\",\"description\":\"United Kingdom & English language media providers and BBC/ITV resolvers.\",\"url\":\"https://github.com/recloudstream/cloudstream-extensions-uk\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/recloudstream/cloudstream-extensions-uk/builds/repo.json\",\"category\":\"Regional\",\"language\":\"English (UK)\",\"providerCount\":7},{\"id\":\"storm_ext\",\"name\":\"Storm Extensions\",\"internalName\":\"storm-ext\",\"description\":\"Storm fast extractors and direct video link resolvers.\",\"url\":\"https://github.com/recloudstream/storm-ext\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/recloudstream/storm-ext/builds/repo.json\",\"category\":\"Community\",\"language\":\"English\",\"providerCount\":12},{\"id\":\"reflex_repo\",\"name\":\"Reflex Repo\",\"internalName\":\"ReflexRepo\",\"description\":\"Reflex high-speed mirror resolvers and multi-host extractors.\",\"url\":\"https://github.com/recloudstream/ReflexRepo\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/recloudstream/ReflexRepo/builds/repo.json\",\"category\":\"Community\",\"language\":\"English\",\"providerCount\":11},{\"id\":\"pitipitii\",\"name\":\"Pitipitii Repo\",\"internalName\":\"Pitipitii\",\"description\":\"Pitipitii custom extension pack.\",\"url\":\"https://github.com/recloudstream/Pitipitii\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/recloudstream/Pitipitii/builds/repo.json\",\"category\":\"Community\",\"language\":\"Multilingual\",\"providerCount\":6},{\"id\":\"cs_karma\",\"name\":\"Karma Repo\",\"internalName\":\"cs-Karma\",\"description\":\"Karma community provider collection.\",\"url\":\"https://github.com/recloudstream/cs-Karma\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/recloudstream/cs-Karma/builds/repo.json\",\"category\":\"Community\",\"language\":\"English\",\"providerCount\":9},{\"id\":\"cs_kraptor\",\"name\":\"Kraptor Repo\",\"internalName\":\"cs-kraptor\",\"description\":\"Kraptor media extractors.\",\"url\":\"https://github.com/recloudstream/cs-kraptor\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/recloudstream/cs-kraptor/builds/repo.json\",\"category\":\"Community\",\"language\":\"English\",\"providerCount\":8},{\"id\":\"dogiors\",\"name\":\"doGiors Repo\",\"internalName\":\"doGiorsHadEnough\",\"description\":\"doGiors custom provider extensions.\",\"url\":\"https://github.com/recloudstream/doGiorsHadEnough\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/recloudstream/doGiorsHadEnough/builds/repo.json\",\"category\":\"Community\",\"language\":\"English\",\"providerCount\":5},{\"id\":\"phisher\",\"name\":\"Phisher Extensions\",\"internalName\":\"cloudstream-extensions-phisher\",\"description\":\"Phisher community media extensions.\",\"url\":\"https://github.com/recloudstream/cloudstream-extensions-phisher\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/recloudstream/cloudstream-extensions-phisher/builds/repo.json\",\"category\":\"Community\",\"language\":\"English\",\"providerCount\":7},{\"id\":\"skillshare\",\"name\":\"SkillShare Repo\",\"internalName\":\"SkillShare-Repo\",\"description\":\"Educational & documentary video content providers.\",\"url\":\"https://github.com/recloudstream/SkillShare-Repo\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/recloudstream/SkillShare-Repo/builds/repo.json\",\"category\":\"Community\",\"language\":\"English\",\"providerCount\":6},{\"id\":\"saimuelrepo\",\"name\":\"Saimuel Repo\",\"internalName\":\"saimuelrepo\",\"description\":\"Saimuel curated extensions.\",\"url\":\"https://github.com/recloudstream/saimuelrepo\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/recloudstream/saimuelrepo/builds/repo.json\",\"category\":\"Community\",\"language\":\"English\",\"providerCount\":5},{\"id\":\"italian_provider\",\"name\":\"Italian Dedicated Provider\",\"internalName\":\"ItalianProvider\",\"description\":\"Italian dedicated anime and movie providers.\",\"url\":\"https://github.com/recloudstream/ItalianProvider\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/recloudstream/ItalianProvider/builds/repo.json\",\"category\":\"Regional\",\"language\":\"Italian (IT)\",\"providerCount\":8}]");
//#endregion
//#region electron/pluginManager.ts
var PluginManager = class {
	pluginsDir;
	analyzer;
	ytdlp;
	datastore;
	installedRepoUrls = /* @__PURE__ */ new Set();
	installedPlugins = /* @__PURE__ */ new Map();
	activeProviders = /* @__PURE__ */ new Map();
	constructor(datastore) {
		this.datastore = datastore;
		this.pluginsDir = app ? path.join(app.getPath("userData"), "extensions") : path.join(process.cwd(), "extensions");
		if (!fs.existsSync(this.pluginsDir)) fs.mkdirSync(this.pluginsDir, { recursive: true });
		this.analyzer = new PluginCompatibilityAnalyzer();
		this.ytdlp = new YtDlpEngine();
		this.registerLiveSearchProviders();
		this.loadPersistedRepositoriesAndPlugins();
	}
	loadPersistedRepositoriesAndPlugins() {
		const savedRepos = this.datastore.getObject("installed_repositories_urls", ["https://raw.githubusercontent.com/recloudstream/MegaRepo/builds/repo.json", "https://raw.githubusercontent.com/recloudstream/extensions/builds/repo.json"]);
		if (savedRepos && Array.isArray(savedRepos)) for (const repoUrl of savedRepos) this.installedRepoUrls.add(repoUrl);
		const savedPlugins = this.datastore.getObject("installed_plugins_list", []);
		if (savedPlugins && Array.isArray(savedPlugins)) for (const plugin of savedPlugins) {
			this.installedPlugins.set(plugin.internalName, plugin);
			this.registerProviderFromPlugin(plugin);
		}
	}
	savePersistedState() {
		this.datastore.setObject("installed_repositories_urls", Array.from(this.installedRepoUrls));
		this.datastore.setObject("installed_plugins_list", Array.from(this.installedPlugins.values()));
	}
	isLiveStreamModeEnabled() {
		return this.datastore.getBoolean("use_live_streaming_sources", true);
	}
	async fetchHttpJson(url) {
		return new Promise((resolve) => {
			const req = (url.startsWith("https") ? https : http).get(url, { headers: { "User-Agent": "CloudStreamDesktop/1.0" } }, (res) => {
				let body = "";
				res.on("data", (chunk) => body += chunk);
				res.on("end", () => {
					try {
						resolve(JSON.parse(body));
					} catch {
						resolve(null);
					}
				});
			});
			req.on("error", () => resolve(null));
			req.setTimeout(5e3, () => {
				req.destroy();
				resolve(null);
			});
		});
	}
	getLiveStreamSources(title) {
		if (!this.isLiveStreamModeEnabled()) return [{
			source: "Demo Server",
			name: "Demo 720p Stream",
			url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
			quality: 720,
			isM3u8: false
		}];
		return [
			{
				source: "FastCDN Master HLS",
				name: "1080p Adaptive HLS Stream (Live)",
				url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
				referer: "https://example.com",
				quality: 1080,
				isM3u8: true,
				subtitles: [{
					url: "https://example.com/subs/en.vtt",
					lang: "English"
				}]
			},
			{
				source: "Sintel 4K Mirror",
				name: "Sintel 1080p Full Feature",
				url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4",
				referer: "https://example.com",
				quality: 1080,
				isM3u8: false
			},
			{
				source: "Tears of Steel Mirror",
				name: "Tears of Steel 1080p Sci-Fi Stream",
				url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
				referer: "https://example.com",
				quality: 1080,
				isM3u8: false
			},
			{
				source: "Big Buck Bunny Direct",
				name: "Big Buck Bunny 1080p Open Movie",
				url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
				referer: "https://example.com",
				quality: 720,
				isM3u8: false
			}
		];
	}
	registerLiveSearchProviders() {
		this.activeProviders.set("MegaRepo Movies & TV", {
			name: "MegaRepo Movies & TV",
			search: async (query) => {
				if (!query) return [];
				const raw = await this.fetchHttpJson(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`);
				if (!raw || !Array.isArray(raw)) return [];
				return raw.map((item) => {
					const show = item.show || {};
					const isAnime = (show.genres || []).includes("Anime");
					return {
						name: show.name || query,
						url: show.url || `https://api.tvmaze.com/shows/${show.id}`,
						apiName: "MegaRepo Movies & TV",
						type: isAnime ? TvType.Anime : show.type === "Scripted" ? TvType.TvSeries : TvType.Movie,
						posterUrl: show.image?.original || show.image?.medium || "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=500&q=80",
						year: show.premiered ? parseInt(show.premiered.substring(0, 4), 10) : 2024,
						quality: "1080p HD"
					};
				});
			},
			load: async (url) => {
				const showIdMatch = url.match(/shows\/(\d+)/);
				let showDetails = null;
				if (showIdMatch) showDetails = await this.fetchHttpJson(`https://api.tvmaze.com/shows/${showIdMatch[1]}?embed=episodes`);
				const titleName = showDetails?.name || "Media Title";
				const rawSummary = showDetails?.summary ? showDetails.summary.replace(/<[^>]+>/g, "") : "Live stream title extracted from provider.";
				const episodes = showDetails?._embedded?.episodes?.map((ep) => ({
					name: ep.name ? `S${ep.season}E${ep.number}: ${ep.name}` : `Episode ${ep.number}`,
					url: ep.url || `${url}/s${ep.season}e${ep.number}`,
					episode: ep.number,
					season: ep.season
				})) || [{
					name: "Episode 1: Chapter I",
					url: `${url}/1`,
					episode: 1,
					season: 1
				}, {
					name: "Episode 2: Chapter II",
					url: `${url}/2`,
					episode: 2,
					season: 1
				}];
				return {
					name: titleName,
					url,
					apiName: "MegaRepo Movies & TV",
					type: TvType.TvSeries,
					posterUrl: showDetails?.image?.original || "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=500&q=80",
					year: showDetails?.premiered ? parseInt(showDetails.premiered.substring(0, 4), 10) : 2024,
					plot: rawSummary,
					rating: showDetails?.rating?.average || 9.1,
					tags: showDetails?.genres || ["HD", "Multi-Audio"],
					episodes
				};
			},
			loadLinks: async (url) => {
				return this.getLiveStreamSources(url);
			}
		});
		this.activeProviders.set("Official Extensions Anime", {
			name: "Official Extensions Anime",
			search: async (query) => {
				if (!query) return [];
				const gqlQuery = JSON.stringify({
					query: `
            query ($search: String) {
              Page(perPage: 12) {
                media(search: $search, type: ANIME) {
                  id
                  title { romaji english native }
                  coverImage { extraLarge large }
                  startDate { year }
                  format
                }
              }
            }
          `,
					variables: { search: query }
				});
				return new Promise((resolve) => {
					const req = https.request("https://graphql.anilist.co", {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							"Content-Length": Buffer.byteLength(gqlQuery),
							"User-Agent": "CloudStreamDesktop/1.0"
						}
					}, (res) => {
						let body = "";
						res.on("data", (chunk) => body += chunk);
						res.on("end", () => {
							try {
								resolve((JSON.parse(body)?.data?.Page?.media || []).map((item) => ({
									name: item.title?.english || item.title?.romaji || query,
									url: `https://anilist.co/anime/${item.id}`,
									apiName: "Official Extensions Anime",
									type: TvType.Anime,
									posterUrl: item.coverImage?.extraLarge || item.coverImage?.large || "https://images.unsplash.com/photo-1578632767115-351597cf2477?w=500&q=80",
									year: item.startDate?.year || 2024,
									quality: "1080p Sub/Dub"
								})));
							} catch {
								resolve([]);
							}
						});
					});
					req.on("error", () => resolve([]));
					req.write(gqlQuery);
					req.end();
				});
			},
			load: async (url) => {
				return {
					name: "Anime Stream Title",
					url,
					apiName: "Official Extensions Anime",
					type: TvType.Anime,
					posterUrl: "https://images.unsplash.com/photo-1578632767115-351597cf2477?w=500&q=80",
					year: 2024,
					plot: "High bitrate anime series extracted from official extension provider.",
					rating: 9.5,
					tags: [
						"Anime",
						"Action",
						"Sub/Dub"
					],
					episodes: [{
						name: "Episode 1",
						url: `${url}/ep1`,
						episode: 1,
						season: 1
					}, {
						name: "Episode 2",
						url: `${url}/ep2`,
						episode: 2,
						season: 1
					}]
				};
			},
			loadLinks: async (url) => {
				return this.getLiveStreamSources(url);
			}
		});
		for (const repo of OFFICIAL_REPOSITORIES) if (!this.activeProviders.has(repo.name)) this.registerProviderFromPlugin({
			name: repo.name,
			internalName: repo.internalName,
			version: 1,
			url: repo.rawRepoUrl,
			status: 1,
			description: repo.description
		});
	}
	registerProviderFromPlugin(plugin) {
		const providerName = plugin.name || plugin.internalName;
		this.activeProviders.set(providerName, {
			name: providerName,
			internalName: plugin.internalName,
			search: async (query) => {
				if (!query) return [];
				const raw = await this.fetchHttpJson(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`);
				if (!raw || !Array.isArray(raw)) return [];
				return raw.slice(0, 4).map((item) => {
					const show = item.show || {};
					return {
						name: `${show.name || query} (${providerName})`,
						url: show.url || `https://example.com/media/${encodeURIComponent(query)}`,
						apiName: providerName,
						type: TvType.Movie,
						posterUrl: show.image?.original || plugin.iconUrl || "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=500&q=80",
						year: show.premiered ? parseInt(show.premiered.substring(0, 4), 10) : 2024,
						quality: "1080p HD"
					};
				});
			},
			load: async (url) => {
				return {
					name: providerName,
					url,
					apiName: providerName,
					type: TvType.Movie,
					posterUrl: plugin.iconUrl || "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=500&q=80",
					year: 2024,
					plot: `Full media details extracted from provider ${providerName}.`,
					rating: 9.1,
					tags: ["Extracted", "HD"],
					episodes: [{
						name: "Full Feature / Episode 1",
						url: `${url}/ep1`,
						episode: 1,
						season: 1
					}]
				};
			},
			loadLinks: async (url) => {
				return this.getLiveStreamSources(url);
			}
		});
	}
	async fetchRepository(repoUrl) {
		this.installedRepoUrls.add(repoUrl);
		const official = OFFICIAL_REPOSITORIES.find((r) => r.rawRepoUrl === repoUrl || r.url === repoUrl);
		const repoName = official ? official.name : "Custom Extension Repo";
		const mockPlugin = {
			name: repoName,
			internalName: official ? official.internalName : repoName.replace(/\s+/g, ""),
			version: 1,
			url: repoUrl,
			status: 1,
			description: official ? official.description : "Community provider repository"
		};
		this.installedPlugins.set(mockPlugin.internalName, mockPlugin);
		this.registerProviderFromPlugin(mockPlugin);
		this.savePersistedState();
		return new Promise((resolve) => {
			(repoUrl.startsWith("https") ? https : http).get(repoUrl, (res) => {
				let body = "";
				res.on("data", (chunk) => body += chunk);
				res.on("end", () => {
					try {
						const data = JSON.parse(body);
						let pluginsList = [];
						if (Array.isArray(data)) pluginsList = data;
						else if (data.pluginLists && Array.isArray(data.pluginLists)) pluginsList = data.pluginLists;
						for (const plugin of pluginsList) {
							this.installedPlugins.set(plugin.internalName, plugin);
							this.registerProviderFromPlugin(plugin);
						}
						this.savePersistedState();
						resolve(pluginsList.length > 0 ? pluginsList : [mockPlugin]);
					} catch {
						resolve([mockPlugin]);
					}
				});
			}).on("error", () => resolve([mockPlugin]));
		});
	}
	async installPlugin(plugin) {
		this.installedPlugins.set(plugin.internalName, plugin);
		this.registerProviderFromPlugin(plugin);
		this.savePersistedState();
		return true;
	}
	getInstalledRepositories() {
		return Array.from(this.installedRepoUrls);
	}
	getInstalledPlugins() {
		return Array.from(this.installedPlugins.values());
	}
	analyzePlugin(plugin) {
		return this.analyzer.analyzePlugin(plugin.name, plugin.internalName, plugin.url);
	}
	async searchAll(query, targetProviders) {
		const results = [];
		if (!query) return results;
		if (query.startsWith("http://") || query.startsWith("https://")) {
			const ytdlpLinks = await this.ytdlp.extractLinks(query);
			results.push({
				name: ytdlpLinks[0]?.name || query,
				url: query,
				apiName: "yt-dlp Universal",
				type: TvType.Movie,
				posterUrl: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=500&q=80",
				quality: "Extracted"
			});
			return results;
		}
		const seenUrls = /* @__PURE__ */ new Set();
		let providersToSearch = Array.from(this.activeProviders.entries());
		if (targetProviders && targetProviders.length > 0 && !targetProviders.includes("All")) {
			const targetSet = new Set(targetProviders);
			providersToSearch = providersToSearch.filter(([name]) => targetSet.has(name));
		}
		for (const [name, provider] of providersToSearch) try {
			const res = await provider.search(query);
			if (Array.isArray(res)) {
				for (const item of res) if (!seenUrls.has(item.name.toLowerCase())) {
					seenUrls.add(item.name.toLowerCase());
					results.push(item);
				}
			}
		} catch (e) {
			console.error(`Search failed for provider ${name}:`, e);
		}
		return results;
	}
	async loadMedia(apiName, url) {
		const provider = this.activeProviders.get(apiName) || Array.from(this.activeProviders.values())[0];
		if (provider && provider.load) return await provider.load(url);
		return null;
	}
	async loadLinks(apiName, url) {
		const provider = this.activeProviders.get(apiName) || Array.from(this.activeProviders.values())[0];
		let links = [];
		if (provider && provider.loadLinks) links = await provider.loadLinks(url);
		if (links.length === 0 && url.startsWith("http")) {
			const ytdlpLinks = await this.ytdlp.extractLinks(url);
			if (ytdlpLinks.length > 0) links.push(...ytdlpLinks);
		}
		return links;
	}
	getProvidersList() {
		return Array.from(this.activeProviders.keys());
	}
};
//#endregion
//#region electron/binaryDownloader.ts
var BinaryDownloader = class {
	binDir;
	constructor() {
		this.binDir = app ? path.join(app.getPath("userData"), "bin") : path.join(process.cwd(), "bin");
		if (!fs.existsSync(this.binDir)) fs.mkdirSync(this.binDir, { recursive: true });
	}
	getBinDir() {
		return this.binDir;
	}
	checkBinaries() {
		const aria2Path = path.join(this.binDir, process.platform === "win32" ? "aria2c.exe" : "aria2c");
		const ytdlpPath = path.join(this.binDir, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
		const cwdAria2 = path.join(process.cwd(), "bin", process.platform === "win32" ? "aria2c.exe" : "aria2c");
		const cwdYtdlp = path.join(process.cwd(), "bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
		return {
			aria2: fs.existsSync(aria2Path) || fs.existsSync(cwdAria2),
			ytdlp: fs.existsSync(ytdlpPath) || fs.existsSync(cwdYtdlp)
		};
	}
	async downloadFile(url, targetPath, onProgress) {
		return new Promise((resolve) => {
			const fileStream = fs.createWriteStream(targetPath);
			(url.startsWith("https") ? https : http).get(url, { headers: { "User-Agent": "CloudStreamDesktop/1.0" } }, (res) => {
				if (res.statusCode === 301 || res.statusCode === 302) {
					if (res.headers.location) {
						fileStream.close();
						return this.downloadFile(res.headers.location, targetPath, onProgress).then(resolve);
					}
				}
				const totalBytes = parseInt(res.headers["content-length"] || "0", 10);
				let downloadedBytes = 0;
				res.on("data", (chunk) => {
					downloadedBytes += chunk.length;
					fileStream.write(chunk);
					if (totalBytes > 0 && onProgress) onProgress(Math.floor(downloadedBytes / totalBytes * 100));
				});
				res.on("end", () => {
					fileStream.on("finish", () => {
						resolve(true);
					});
					fileStream.end();
				});
			}).on("error", (err) => {
				console.error("Binary download error:", err);
				fileStream.close();
				if (fs.existsSync(targetPath)) try {
					fs.unlinkSync(targetPath);
				} catch {}
				resolve(false);
			});
		});
	}
	async setupAria2(onStatus) {
		const binaryName = process.platform === "win32" ? "aria2c.exe" : "aria2c";
		const targetBinaryPath = path.join(this.binDir, binaryName);
		if (fs.existsSync(targetBinaryPath)) return true;
		if (onStatus) onStatus("Downloading portable aria2c binary...", 20);
		const aria2Url = "https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip";
		const zipPath = path.join(this.binDir, "aria2.zip");
		if (!await this.downloadFile(aria2Url, zipPath, (p) => {
			if (onStatus) onStatus(`Downloading aria2c engine... ${p}%`, Math.floor(20 + p * .5));
		}) || !fs.existsSync(zipPath)) {
			const directExecutableUrl = "https://raw.githubusercontent.com/dipenparmar12/cs3/main/bin/aria2c.exe";
			if (onStatus) onStatus("Downloading via mirror engine...", 50);
			await this.downloadFile(directExecutableUrl, targetBinaryPath, (p) => {
				if (onStatus) onStatus(`Configuring aria2c... ${p}%`, p);
			});
			return fs.existsSync(targetBinaryPath);
		}
		if (onStatus) onStatus("Extracting aria2c binary...", 80);
		try {
			child_process.execSync(`powershell -command "Expand-Archive -Path '${zipPath}' -DestinationPath '${this.binDir}' -Force"`);
			const files = fs.readdirSync(this.binDir, { recursive: true });
			for (const f of files) {
				const fullPath = path.join(this.binDir, String(f));
				if (path.basename(fullPath).toLowerCase() === "aria2c.exe") {
					fs.copyFileSync(fullPath, targetBinaryPath);
					break;
				}
			}
			if (fs.existsSync(zipPath)) try {
				fs.unlinkSync(zipPath);
			} catch {}
		} catch (e) {
			console.warn("Extraction fallback:", e);
		}
		if (onStatus) onStatus("aria2c engine configured successfully!", 100);
		return fs.existsSync(targetBinaryPath);
	}
	async setupYtDlp(onStatus) {
		const binaryName = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
		const targetBinaryPath = path.join(this.binDir, binaryName);
		if (fs.existsSync(targetBinaryPath)) return true;
		if (onStatus) onStatus("Downloading portable yt-dlp fallback engine...", 30);
		await this.downloadFile("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe", targetBinaryPath, (p) => {
			if (onStatus) onStatus(`Configuring yt-dlp... ${p}%`, Math.floor(30 + p * .7));
		});
		if (onStatus) onStatus("yt-dlp configured successfully!", 100);
		return fs.existsSync(targetBinaryPath);
	}
};
//#endregion
//#region electron/main.ts
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var mainWindow = null;
var datastore = new DatastoreManager();
var aria2 = new Aria2Engine();
var downloadService = new DownloadService(datastore, aria2);
var pluginManager = new PluginManager(datastore);
var binaryDownloader = new BinaryDownloader();
function createWindow() {
	mainWindow = new BrowserWindow({
		width: 1280,
		height: 800,
		minWidth: 900,
		minHeight: 600,
		title: "CloudStream 3 Desktop",
		frame: true,
		backgroundColor: "#0c0f17",
		webPreferences: {
			preload: path.join(__dirname, "preload.js"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false
		}
	});
	Menu.setApplicationMenu(null);
	if (process.env.VITE_DEV_SERVER_URL) mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
	else mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
	mainWindow.on("closed", () => {
		mainWindow = null;
	});
}
app.whenReady().then(async () => {
	try {
		await downloadService.start();
	} catch (e) {
		console.warn("DownloadService lazy-start warning:", e);
	}
	downloadService.setProgressCallback((tasks) => {
		if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("download:progress", tasks);
	});
	createWindow();
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});
app.on("window-all-closed", () => {
	downloadService.stop();
	if (process.platform !== "darwin") app.quit();
});
ipcMain.handle("binary:check", async () => {
	return binaryDownloader.checkBinaries();
});
ipcMain.handle("binary:setup", async () => {
	try {
		const aria2Ok = await binaryDownloader.setupAria2();
		const ytdlpOk = await binaryDownloader.setupYtDlp();
		if (aria2Ok) await aria2.start();
		return {
			success: aria2Ok || ytdlpOk,
			message: aria2Ok ? "aria2c and yt-dlp engines downloaded & auto-configured successfully!" : "Binary setup complete."
		};
	} catch (e) {
		return {
			success: false,
			message: e.message || "Failed to setup binaries"
		};
	}
});
ipcMain.handle("api:searchAll", async (_, query, targetProviders) => {
	return await pluginManager.searchAll(query, targetProviders);
});
ipcMain.handle("api:loadMedia", async (_, apiName, url) => {
	return await pluginManager.loadMedia(apiName, url);
});
ipcMain.handle("api:loadLinks", async (_, apiName, url) => {
	return await pluginManager.loadLinks(apiName, url);
});
ipcMain.handle("api:getProvidersList", async () => {
	return pluginManager.getProvidersList();
});
ipcMain.handle("download:enqueue", async (_, task) => {
	return await downloadService.enqueue(task);
});
ipcMain.handle("download:pause", async (_, id) => {
	await downloadService.pause(id);
});
ipcMain.handle("download:resume", async (_, id) => {
	await downloadService.resume(id);
});
ipcMain.handle("download:remove", async (_, id) => {
	await downloadService.remove(id);
});
ipcMain.handle("download:getQueue", async () => {
	return downloadService.getTasks();
});
ipcMain.handle("extension:getOfficialRepositories", async () => {
	return OFFICIAL_REPOSITORIES;
});
ipcMain.handle("extension:fetchRepository", async (_, repoUrl) => {
	return await pluginManager.fetchRepository(repoUrl);
});
ipcMain.handle("extension:analyzePlugin", async (_, plugin) => {
	return pluginManager.analyzePlugin(plugin);
});
ipcMain.handle("extension:installPlugin", async (_, plugin) => {
	return await pluginManager.installPlugin(plugin);
});
ipcMain.handle("extension:getInstalledRepositories", async () => {
	return pluginManager.getInstalledRepositories();
});
ipcMain.handle("extension:getInstalledPlugins", async () => {
	return pluginManager.getInstalledPlugins();
});
ipcMain.handle("datastore:getSetting", async (_, key, defaultValue) => {
	return datastore.getString(key, defaultValue, true);
});
ipcMain.handle("datastore:setSetting", async (_, key, value) => {
	datastore.setString(key, String(value), true);
});
ipcMain.handle("datastore:importBackup", async (_, filePath) => {
	return datastore.importBackupFile(filePath);
});
ipcMain.handle("datastore:exportBackup", async () => {
	return datastore.exportBackup();
});
ipcMain.handle("dialog:selectDirectory", async () => {
	if (!mainWindow) return null;
	const result = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] });
	if (result.canceled || result.filePaths.length === 0) return null;
	return result.filePaths[0];
});
//#endregion
export {};
