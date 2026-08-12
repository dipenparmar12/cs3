import { createRequire as e } from "node:module";
import { BrowserWindow as t, Menu as n, app as r, dialog as i, ipcMain as a, shell as o } from "electron";
import s from "path";
import { fileURLToPath as c } from "url";
import l from "fs";
import u, { spawn as d } from "child_process";
import f from "crypto";
import p from "http";
import ee from "https";
import te from "os";
import ne from "webtorrent";
import { XMLParser as re } from "fast-xml-parser";
//#region \0rolldown/runtime.js
var ie = /* @__PURE__ */ e(import.meta.url), ae = class {
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
		this.dataDir = r ? r.getPath("userData") : s.join(process.cwd(), "data"), l.existsSync(this.dataDir) || l.mkdirSync(this.dataDir, { recursive: !0 }), this.dbFile = s.join(this.dataDir, "cs3_datastore.json"), this.backupSnapshotFile = s.join(this.dataDir, "cs3_datastore_snapshot.json"), this.data = this.loadFromFile();
	}
	loadFromFile() {
		try {
			if (l.existsSync(this.dbFile)) {
				let e = l.readFileSync(this.dbFile, "utf-8");
				return JSON.parse(e);
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
			l.writeFileSync(this.dbFile, JSON.stringify(this.data, null, 2), "utf-8");
		} catch (e) {
			console.error("Failed to save datastore:", e);
		}
	}
	createSnapshot() {
		try {
			l.writeFileSync(this.backupSnapshotFile, JSON.stringify(this.data, null, 2), "utf-8");
		} catch (e) {
			console.error("Failed to create datastore snapshot:", e);
		}
	}
	rollbackSnapshot() {
		try {
			if (l.existsSync(this.backupSnapshotFile)) {
				let e = l.readFileSync(this.backupSnapshotFile, "utf-8");
				return this.data = JSON.parse(e), this.save(), !0;
			}
		} catch (e) {
			console.error("Failed to rollback datastore snapshot:", e);
		}
		return !1;
	}
	isKeyTransferable(e) {
		return !this.nonTransferableKeyPatterns.some((t) => t.test(e));
	}
	setString(e, t, n = !1) {
		let r = n ? this.data.settings : this.data.datastore;
		r._String ||= {}, r._String[e] = t, this.save();
	}
	getString(e, t = "", n = !1) {
		return (n ? this.data.settings : this.data.datastore)._String?.[e] ?? t;
	}
	setBool(e, t, n = !1) {
		let r = n ? this.data.settings : this.data.datastore;
		r._Bool ||= {}, r._Bool[e] = t, this.save();
	}
	getBool(e, t = !1, n = !1) {
		return (n ? this.data.settings : this.data.datastore)._Bool?.[e] ?? t;
	}
	setBoolean(e, t, n = !1) {
		this.setBool(e, t, n);
	}
	getBoolean(e, t = !1, n = !1) {
		return this.getBool(e, t, n);
	}
	setInt(e, t, n = !1) {
		let r = n ? this.data.settings : this.data.datastore;
		r._Int ||= {}, r._Int[e] = Math.floor(t), this.save();
	}
	getInt(e, t = 0, n = !1) {
		return (n ? this.data.settings : this.data.datastore)._Int?.[e] ?? t;
	}
	setObject(e, t, n = !1) {
		this.setString(e, JSON.stringify(t), n);
	}
	getObject(e, t = null, n = !1) {
		let r = this.getString(e, "", n);
		if (!r) return t;
		try {
			return JSON.parse(r);
		} catch {
			return t;
		}
	}
	importBackupFile(e) {
		let t = [], n = 0;
		try {
			this.createSnapshot();
			let r = l.readFileSync(e, "utf-8"), i = JSON.parse(r);
			t.push(`Starting import from: ${s.basename(e)}`);
			let a = (e, r, i = "datastore") => {
				if (!(!e || !r)) for (let a of [
					"_Bool",
					"_Int",
					"_String",
					"_Float",
					"_Long",
					"_StringSet"
				]) {
					let o = e[a];
					if (o) {
						r[a] || (r[a] = {});
						let e = r[a];
						for (let [r, s] of Object.entries(o)) this.isKeyTransferable(r) ? (e[r] = s, n++) : t.push(`Skipped non-transferable key [${i}.${a}]: ${r}`);
					}
				}
			};
			return a(i.datastore, this.data.datastore, "datastore"), a(i.settings, this.data.settings, "settings"), this.save(), t.push(`Successfully imported ${n} keys into local Datastore.`), {
				success: !0,
				importedKeysCount: n,
				report: t
			};
		} catch (e) {
			return this.rollbackSnapshot(), t.push(`Import failed, rolled back snapshot: ${e.message}`), {
				success: !1,
				importedKeysCount: 0,
				report: t
			};
		}
	}
	exportBackup() {
		return this.data.exportTimestamp = Date.now(), JSON.stringify(this.data, null, 2);
	}
}, oe = class {
	aria2Process = null;
	rpcSecret;
	port = 6800;
	constructor() {
		this.rpcSecret = f.randomUUID();
	}
	getBinaryPath() {
		let e = process.platform === "win32" ? "aria2c.exe" : "aria2c", t = r ? s.join(r.getPath("userData"), "bin", e) : "", n = s.join(process.cwd(), "bin", e);
		return t && l.existsSync(t) ? t : l.existsSync(n) ? n : null;
	}
	async start() {
		try {
			let e = this.getBinaryPath();
			if (!e) return console.warn("aria2c binary not found. Downloads will use HTTP stream fallback."), !1;
			let t = [
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
			return this.aria2Process = d(e, t, { stdio: "ignore" }), this.aria2Process.on("error", (e) => {
				console.warn("aria2c spawn process warning:", e.message), this.aria2Process = null;
			}), !0;
		} catch (e) {
			return console.warn("Failed to start aria2 engine:", e), !1;
		}
	}
	isRunning() {
		return this.aria2Process !== null;
	}
	async sendRpc(e, t = []) {
		return new Promise((n, r) => {
			let i = JSON.stringify({
				jsonrpc: "2.0",
				id: f.randomUUID(),
				method: `aria2.${e}`,
				params: [`token:${this.rpcSecret}`, ...t]
			}), a = p.request({
				hostname: "127.0.0.1",
				port: this.port,
				path: "/jsonrpc",
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Content-Length": Buffer.byteLength(i)
				}
			}, (e) => {
				let t = "";
				e.on("data", (e) => t += e), e.on("end", () => {
					try {
						let e = JSON.parse(t);
						e.error ? r(Error(e.error.message)) : n(e.result);
					} catch (e) {
						r(e);
					}
				});
			});
			a.on("error", r), a.write(i), a.end();
		});
	}
	async addUri(e, t, n, r = {}) {
		if (!this.aria2Process) throw Error("aria2c engine binary not running");
		let i = [];
		for (let [e, t] of Object.entries(r)) i.push(`${e}: ${t}`);
		let a = {
			dir: t,
			out: n,
			header: i,
			"max-connection-per-server": "16",
			split: "16"
		};
		return await this.sendRpc("addUri", [[e], a]);
	}
	async getStatus(e) {
		if (!this.aria2Process) return {
			gid: e,
			status: "error",
			totalLength: 0,
			completedLength: 0,
			downloadSpeed: 0,
			errorMessage: "Engine not running"
		};
		let t = await this.sendRpc("tellStatus", [e, [
			"gid",
			"status",
			"totalLength",
			"completedLength",
			"downloadSpeed",
			"errorCode",
			"errorMessage"
		]]);
		return {
			gid: t.gid,
			status: t.status,
			totalLength: parseInt(t.totalLength || "0", 10),
			completedLength: parseInt(t.completedLength || "0", 10),
			downloadSpeed: parseInt(t.downloadSpeed || "0", 10),
			errorCode: t.errorCode,
			errorMessage: t.errorMessage
		};
	}
	async pause(e) {
		return this.aria2Process ? await this.sendRpc("pause", [e]) : e;
	}
	async unpause(e) {
		return this.aria2Process ? await this.sendRpc("unpause", [e]) : e;
	}
	async remove(e) {
		return this.aria2Process ? await this.sendRpc("remove", [e]) : e;
	}
	stop() {
		this.aria2Process &&= (this.aria2Process.kill(), null);
	}
}, m = {
	Downloading: "Downloading",
	Queued: "Queued",
	Paused: "Paused",
	Completed: "Completed",
	Failed: "Failed"
}, se = class {
	aria2;
	defaultDownloadDir;
	constructor(e) {
		this.aria2 = e, this.defaultDownloadDir = s.join(te.homedir(), "Downloads", "CloudStream");
	}
	getDefaultDirectory() {
		return this.defaultDownloadDir;
	}
	sanitizeFilename(e) {
		return e.replace(/[<>:"/\\|?*]/g, "_").replace(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i, "_$1_").trim();
	}
	generateTargetFilePath(e, t) {
		let n = t || this.defaultDownloadDir, r = e.title ? "Shows" : "Downloads", i = this.sanitizeFilename(e.title || "Media"), a = `${i}`;
		if (e.seasonNumber !== void 0 && e.episodeNumber !== void 0) {
			let t = String(e.seasonNumber).padStart(2, "0"), n = String(e.episodeNumber).padStart(2, "0");
			a += `_S${t}E${n}`;
		} else if (e.episodeNumber !== void 0) {
			let t = String(e.episodeNumber).padStart(2, "0");
			a += `_E${t}`;
		}
		return a += ".mp4", s.join(n, r, i, a);
	}
	async dispatchDownload(e) {
		let t = e.targetFilePath || this.generateTargetFilePath(e), n = s.dirname(t), r = s.basename(t);
		return await this.aria2.addUri(e.link.url, n, r, e.headers);
	}
}, ce = class e {
	datastore;
	aria2;
	resolver;
	torrentEngine = null;
	queue = /* @__PURE__ */ new Map();
	gidToTaskId = /* @__PURE__ */ new Map();
	torrentTasks = /* @__PURE__ */ new Map();
	activeFallbackStreams = /* @__PURE__ */ new Map();
	pollInterval = null;
	onProgressCallback;
	constructor(e, t) {
		this.datastore = e, this.aria2 = t, this.resolver = new se(t), this.loadQueueFromStorage();
	}
	setTorrentEngine(e) {
		this.torrentEngine = e;
	}
	static isMagnet(e) {
		return e.startsWith("magnet:") || /^[a-f0-9]{40}$/i.test(e);
	}
	loadQueueFromStorage() {
		let e = this.datastore.getObject("download_queue_list", []);
		if (e && Array.isArray(e)) for (let t of e) t.state === m.Downloading && (t.state = m.Queued), this.queue.set(t.id, t);
	}
	saveQueueToStorage() {
		let e = Array.from(this.queue.values());
		this.datastore.setObject("download_queue_list", e), this.onProgressCallback && this.onProgressCallback(e);
	}
	setProgressCallback(e) {
		this.onProgressCallback = e;
	}
	async start() {
		await this.aria2.start(), this.startPolling();
	}
	startPolling() {
		this.pollInterval && clearInterval(this.pollInterval), this.pollInterval = setInterval(async () => {
			await this.pollStatus();
		}, 1e3);
	}
	async pollStatus() {
		if (await this.pollTorrentTasks(), this.aria2.isRunning()) for (let [e, t] of this.gidToTaskId.entries()) try {
			let n = await this.aria2.getStatus(e), r = this.queue.get(t);
			r && (r.bytesDownloaded = n.completedLength, r.totalBytes = n.totalLength, r.downloadSpeed = n.downloadSpeed, r.etaSeconds = n.downloadSpeed > 0 && n.totalLength > n.completedLength ? Math.ceil((n.totalLength - n.completedLength) / n.downloadSpeed) : 0, n.status === "completed" ? (r.state = m.Completed, this.gidToTaskId.delete(e)) : n.status === "error" && (r.state = m.Failed, r.errorMessage = n.errorMessage || "aria2 transfer error", this.gidToTaskId.delete(e)), this.saveQueueToStorage());
		} catch {}
	}
	async pollTorrentTasks() {
		if (!this.torrentEngine || this.torrentTasks.size === 0) return;
		let e = !1;
		for (let [t, n] of this.torrentTasks.entries()) {
			let r = this.queue.get(t);
			if (!r) {
				this.torrentTasks.delete(t);
				continue;
			}
			let i = await this.torrentEngine.getStats(n);
			i && (r.bytesDownloaded = i.downloaded, r.totalBytes = i.fileSize, r.downloadSpeed = i.downloadSpeed, r.etaSeconds = Math.round(i.timeRemainingMs / 1e3) || 0, i.error ? (r.state = m.Failed, r.errorMessage = i.error, this.torrentTasks.delete(t)) : i.progress >= 1 ? (r.state = m.Completed, r.downloadSpeed = 0, r.etaSeconds = 0, this.torrentTasks.delete(t)) : r.state = i.isPaused ? m.Paused : m.Downloading, e = !0);
		}
		e && this.saveQueueToStorage();
	}
	async enqueue(t) {
		t.state = m.Downloading, t.createdTime = Date.now(), t.targetFilePath ||= this.resolver.generateTargetFilePath(t);
		let n = s.dirname(t.targetFilePath);
		if (l.existsSync(n) || l.mkdirSync(n, { recursive: !0 }), e.isMagnet(t.link.url) && this.torrentEngine) try {
			this.torrentEngine.setDownloadPath(n);
			let e = await this.torrentEngine.startStream({
				torrentId: t.link.url,
				season: t.seasonNumber,
				episode: t.episodeNumber
			});
			return this.torrentTasks.set(t.id, e.infoHash), t.totalBytes = e.fileSize, t.targetFilePath = s.join(n, e.fileName), this.queue.set(t.id, t), this.saveQueueToStorage(), t.id;
		} catch (e) {
			return t.state = m.Failed, t.errorMessage = e instanceof Error ? e.message : String(e), this.queue.set(t.id, t), this.saveQueueToStorage(), t.id;
		}
		if (/\.m3u8(\?|$)/i.test(t.link.url) || t.link.isM3u8) return t.state = m.Failed, t.errorMessage = "HLS streams need segment muxing, which this build cannot do yet. Install yt-dlp from Settings and download via the source URL instead.", this.queue.set(t.id, t), this.saveQueueToStorage(), t.id;
		if (this.aria2.isRunning()) try {
			let e = await this.resolver.dispatchDownload(t);
			return this.gidToTaskId.set(e, t.id), this.queue.set(t.id, t), this.saveQueueToStorage(), t.id;
		} catch {
			console.warn("aria2 dispatch failed, falling back to Native HTTP Downloader");
		}
		return this.startNativeHttpDownload(t), this.queue.set(t.id, t), this.saveQueueToStorage(), t.id;
	}
	startNativeHttpDownload(e) {
		let t = e.link.url, n = t.startsWith("https") ? ee : p, r = l.createWriteStream(e.targetFilePath), i = Date.now(), a = 0, o = n.get(t, { headers: e.headers || {
			"User-Agent": "CloudStreamDesktop/1.0",
			Referer: e.link.referer || ""
		} }, (t) => {
			if ((t.statusCode === 301 || t.statusCode === 302) && t.headers.location) {
				e.link.url = t.headers.location, r.close(), this.startNativeHttpDownload(e);
				return;
			}
			e.totalBytes = parseInt(t.headers["content-length"] || "0", 10) || 52428800;
			let n = 0;
			t.on("data", (t) => {
				n += t.length, r.write(t), e.bytesDownloaded = n;
				let o = Date.now(), s = (o - i) / 1e3;
				s >= 1 && (e.downloadSpeed = Math.floor((n - a) / s), a = n, i = o, e.totalBytes > n && e.downloadSpeed > 0 && (e.etaSeconds = Math.ceil((e.totalBytes - n) / e.downloadSpeed)), this.saveQueueToStorage());
			}), t.on("end", () => {
				r.end(), e.state = m.Completed, e.bytesDownloaded = e.totalBytes || n, e.downloadSpeed = 0, e.etaSeconds = 0, this.activeFallbackStreams.delete(e.id), this.saveQueueToStorage();
			});
		});
		o.on("error", (t) => {
			r.close(), e.state = m.Failed, e.errorMessage = t.message || "Stream download error", this.activeFallbackStreams.delete(e.id), this.saveQueueToStorage();
		}), this.activeFallbackStreams.set(e.id, {
			req: o,
			fileStream: r
		});
	}
	async pause(e) {
		let t = this.queue.get(e);
		if (!t) return;
		t.state = m.Paused;
		let n = this.torrentTasks.get(e);
		if (n && this.torrentEngine) {
			await this.torrentEngine.pause(n), this.saveQueueToStorage();
			return;
		}
		for (let [t, n] of this.gidToTaskId.entries()) n === e && await this.aria2.pause(t);
		let r = this.activeFallbackStreams.get(e);
		r && (r.req.destroy(), r.fileStream.close(), this.activeFallbackStreams.delete(e)), this.saveQueueToStorage();
	}
	async resume(e) {
		let t = this.queue.get(e);
		if (!t || t.state !== m.Paused) return;
		let n = this.torrentTasks.get(e);
		if (n && this.torrentEngine) {
			t.state = m.Downloading, await this.torrentEngine.resume(n), this.saveQueueToStorage();
			return;
		}
		t.state = m.Downloading, await this.enqueue(t), this.saveQueueToStorage();
	}
	async remove(e) {
		let t = this.queue.get(e);
		if (!t) return;
		let n = this.torrentTasks.get(e);
		n && this.torrentEngine && (await this.torrentEngine.stopStream(n, t.state === m.Completed), this.torrentTasks.delete(e));
		for (let [t, n] of this.gidToTaskId.entries()) n === e && (await this.aria2.remove(t), this.gidToTaskId.delete(t));
		let r = this.activeFallbackStreams.get(e);
		r && (r.req.destroy(), r.fileStream.close(), this.activeFallbackStreams.delete(e)), this.queue.delete(e), this.saveQueueToStorage();
	}
	getTasks() {
		return Array.from(this.queue.values());
	}
	stop() {
		this.pollInterval && clearInterval(this.pollInterval);
		for (let [, e] of this.activeFallbackStreams) e.req.destroy(), e.fileStream.close();
		this.aria2.stop();
	}
}, h = {
	TierA_SourceJVM: "Tier A (Source-Rebuilt JVM)",
	TierB_LegacyDEX: "Tier B (Legacy DEX Translator)",
	TierC_NativeTS: "Tier C (Native TypeScript SDK)",
	TierC_NativeKMP: "Tier C (Kotlin Multiplatform JS)",
	NotAnalyzed: "Not analyzed",
	Unsupported: "Unsupported"
}, le = Buffer.from([
	100,
	101,
	120,
	10
]), ue = Buffer.from([80, 75]), de = [
	"Landroid/util/Log;",
	"Landroid/util/Base64;",
	"Landroid/content/Context;",
	"Landroid/content/SharedPreferences;",
	"Landroid/webkit/CookieManager;",
	"Landroid/net/Uri;",
	"Landroid/os/Build;"
], fe = [
	"Landroid/view/",
	"Landroid/widget/",
	"Landroid/app/Activity;",
	"Landroid/app/Dialog;",
	"Landroid/graphics/",
	"Landroid/media/",
	"Landroid/hardware/",
	"Landroid/telephony/",
	"Landroid/content/pm/PackageManager;"
], pe = [
	"Landroid/webkit/WebView;",
	"WebViewResolver",
	"CloudflareKiller"
], me = class {
	analyzePlugin(e, t, n) {
		if (/\.(ts|js|mjs)$/i.test(n)) return {
			pluginName: e,
			internalName: t,
			format: "JS",
			compatibilityScore: 100,
			confidence: "High",
			recommendedTier: h.TierC_NativeTS,
			androidApiReferences: 0,
			hasNativeLibs: !1,
			hasReflection: !1,
			networkStack: "Brokered fetch",
			htmlParser: "Cheerio",
			details: ["Native TypeScript extension — runs in a sandboxed V8 isolate."]
		};
		if (!n || !l.existsSync(n)) return this.notAnalyzed(e, t, "The archive is not present locally. Install the plugin to analyse it.");
		let r;
		try {
			r = this.inspectArchive(n);
		} catch (n) {
			return this.notAnalyzed(e, t, `Archive could not be read: ${n instanceof Error ? n.message : String(n)}`);
		}
		if (!r.isZip) return {
			...this.notAnalyzed(e, t, "Not a ZIP archive — not a valid .cs3 file."),
			confidence: "Unsupported",
			recommendedTier: h.Unsupported,
			compatibilityScore: 0
		};
		let i = [`Archive size: ${(r.sizeBytes / 1024).toFixed(1)} KB`];
		if (r.manifestClassName ? i.push(`Plugin entry class: ${r.manifestClassName}`) : i.push("No pluginClassName in manifest.json — entry point unknown."), !r.hasDex) return i.push("No classes.dex found; the archive carries no Android bytecode."), {
			pluginName: e,
			internalName: t,
			format: "CS3",
			compatibilityScore: 0,
			confidence: "Unsupported",
			recommendedTier: h.Unsupported,
			androidApiReferences: 0,
			hasNativeLibs: r.hasNativeLibs,
			hasReflection: !1,
			networkStack: "Unknown",
			htmlParser: "Unknown",
			details: i
		};
		let a = r.dexPayload?.toString("latin1") ?? "", o = de.filter((e) => a.includes(e)), s = fe.filter((e) => a.includes(e)), c = pe.some((e) => a.includes(e)), u = a.includes("Ljava/lang/reflect/") || a.includes("Ljava/lang/Class;"), d = 100;
		s.length > 0 && (d -= Math.min(45, s.length * 12)), r.hasNativeLibs && (d -= 60), c && (d -= 10), d = Math.max(0, d), o.length > 0 && i.push(`Shimmed Android APIs referenced: ${o.length} (${o.join(", ")})`), s.length > 0 && i.push(`Android APIs with no shim: ${s.join(", ")} — these would degrade or fail.`), c && i.push("References WebView/Cloudflare bypass — needs the offscreen browser bridge."), r.hasNativeLibs && i.push("Contains native .so libraries — not loadable in a sandboxed JVM."), u && i.push("Uses reflection — expected for plugin entry points, but worth noting."), i.push("Static analysis only. Nothing in this build can execute a .cs3; see docs/PRD/31-cs3-dropin-compatibility.md.");
		let f = r.hasNativeLibs ? h.Unsupported : h.TierB_LegacyDEX;
		return {
			pluginName: e,
			internalName: t,
			format: "CS3",
			compatibilityScore: d,
			confidence: r.hasNativeLibs ? "Unsupported" : s.length > 0 ? "Low" : "Medium",
			recommendedTier: f,
			androidApiReferences: o.length + s.length,
			hasNativeLibs: r.hasNativeLibs,
			hasReflection: u,
			networkStack: a.includes("okhttp3") ? "OkHttp / NiceHttp" : "Unknown",
			htmlParser: a.includes("org/jsoup") ? "Jsoup" : "Unknown",
			details: i
		};
	}
	notAnalyzed(e, t, n) {
		return {
			pluginName: e,
			internalName: t,
			format: "CS3",
			compatibilityScore: 0,
			confidence: "Low",
			recommendedTier: h.NotAnalyzed,
			androidApiReferences: 0,
			hasNativeLibs: !1,
			hasReflection: !1,
			networkStack: "Unknown",
			htmlParser: "Unknown",
			details: [n]
		};
	}
	inspectArchive(e) {
		let t = l.readFileSync(e), n = {
			isZip: t.subarray(0, 2).equals(ue),
			hasDex: !1,
			hasNativeLibs: !1,
			sizeBytes: t.length,
			dexPayload: null,
			entryNames: []
		};
		if (!n.isZip) return n;
		let r = [], i = 0;
		for (; i + 30 <= t.length && t.readUInt32LE(i) === 67324752;) {
			let e = t.readUInt16LE(i + 8), a = t.readUInt32LE(i + 18), o = t.readUInt16LE(i + 26), s = t.readUInt16LE(i + 28), c = i + 30, l = t.subarray(c, c + o).toString("utf8"), u = c + o + s;
			if (n.entryNames.push(l), (/\.so$/i.test(l) || l.startsWith("lib/")) && (n.hasNativeLibs = !0), a === 0 && e !== 0) break;
			let d = t.subarray(u, u + a);
			if (/(^|\/)classes\d*\.dex$/i.test(l) || /(^|\/)manifest\.json$/i.test(l)) {
				let t = null;
				try {
					if (e === 0) t = Buffer.from(d);
					else if (e === 8) {
						let { inflateRawSync: e } = ie("zlib");
						t = e(d);
					}
				} catch {
					t = null;
				}
				if (t) {
					if (/\.dex$/i.test(l)) t.subarray(0, 4).equals(le) && (n.hasDex = !0, r.push(t));
					else try {
						let e = JSON.parse(t.toString("utf8")), r = e.pluginClassName ?? e.pluginClass;
						typeof r == "string" && (n.manifestClassName = r);
					} catch {}
				}
			}
			i = u + a;
		}
		return r.length > 0 && (n.dexPayload = Buffer.concat(r)), n;
	}
}, he = 12e3, ge = 1, _e = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) CloudStreamDesktop/1.0", ve = class extends Error {
	status;
	url;
	constructor(e, t, n) {
		super(e), this.name = "HttpError", this.status = t, this.url = n;
	}
};
function ye(e) {
	let t = e.filter((e) => !!e);
	if (t.length === 1) return t[0];
	let n = new AbortController();
	for (let e of t) {
		if (e.aborted) {
			n.abort(e.reason);
			break;
		}
		e.addEventListener("abort", () => n.abort(e.reason), { once: !0 });
	}
	return n.signal;
}
async function be(e, t) {
	let n = t.timeoutMs ?? he, r = ye([AbortSignal.timeout(n), t.signal]), i = await fetch(e, {
		signal: r,
		redirect: "follow",
		headers: {
			"User-Agent": _e,
			Accept: "*/*",
			"Accept-Language": "en-US,en;q=0.9",
			...t.headers
		}
	});
	if (!i.ok) throw new ve(`HTTP ${i.status} ${i.statusText}`, i.status, e);
	return i;
}
async function g(e, t) {
	let n = t.retries ?? ge, r;
	for (let i = 0; i <= n; i++) try {
		return await be(e, t);
	} catch (e) {
		r = e;
		let a = e instanceof ve && e.status !== void 0 && e.status >= 400 && e.status < 500, o = t.signal?.aborted === !0;
		if (a || o || i === n) break;
		await new Promise((e) => setTimeout(e, 400 * (i + 1)));
	}
	throw r;
}
async function _(e, t = {}) {
	return await (await g(e, {
		...t,
		headers: {
			Accept: "application/json",
			...t.headers
		}
	})).json();
}
async function v(e, t = {}) {
	return await (await g(e, t)).text();
}
async function xe(e, t = {}) {
	let n = await g(e, t);
	return Buffer.from(await n.arrayBuffer());
}
//#endregion
//#region electron/cs3/sidecarSupervisor.ts
var Se = 6e4, Ce = 3, we = class {
	proc = null;
	pending = /* @__PURE__ */ new Map();
	nextId = 1;
	restarts = 0;
	stdoutBuffer = "";
	startFailure = null;
	lastStatus = null;
	starting = null;
	dataDir;
	resourceDir;
	constructor(e, t) {
		this.dataDir = e ?? (r ? s.join(r.getPath("userData"), "cs3-runtime") : s.join(process.cwd(), "cs3-runtime")), this.resourceDir = t ?? (r?.isPackaged ? s.join(process.resourcesPath, "sidecar") : s.join(process.cwd(), "..", "sidecar", "target")), l.mkdirSync(this.dataDir, { recursive: !0 });
	}
	async ensureStarted() {
		return this.proc && !this.proc.killed ? !0 : this.restarts > Ce ? !1 : (this.starting ||= this.start().finally(() => {
			this.starting = null;
		}), this.starting);
	}
	async start() {
		let e = s.join(this.resourceDir, "cs3-sidecar.jar"), t = s.join(this.resourceDir, "lib");
		if (!l.existsSync(e)) return this.startFailure = `The extension runtime is not installed (${e} is missing). Build it with "mvn -f sidecar/pom.xml package", or reinstall the app.`, !1;
		let n = this.resolveJava();
		if (!n) return this.startFailure = "No Java runtime was found. The app ships a bundled JRE; if this build was assembled without it, install a Java 21 runtime or reinstall the app.", !1;
		let r = [e, s.join(t, "*")].join(s.delimiter), i = s.join(this.resourceDir, "runtime");
		try {
			this.proc = d(n, [
				"-Xmx512m",
				"-Djava.library.path=",
				"-Dfile.encoding=UTF-8",
				"-cp",
				r,
				"com.cloudstream.desktop.sidecar.Main",
				`--data-dir=${this.dataDir}`,
				`--runtime-classpath=${i}`
			], {
				stdio: [
					"pipe",
					"pipe",
					"pipe"
				],
				windowsHide: !0
			});
		} catch (e) {
			return this.startFailure = `The extension runtime failed to start: ${e instanceof Error ? e.message : String(e)}`, !1;
		}
		this.startFailure = null, this.proc.stdout.setEncoding("utf8"), this.proc.stdout.on("data", (e) => this.onStdout(e)), this.proc.stderr.setEncoding("utf8"), this.proc.stderr.on("data", (e) => {
			for (let t of e.split("\n")) t.trim() && console.warn(`[cs3-sidecar] ${t}`);
		}), this.proc.on("exit", (e, t) => this.onExit(e, t)), this.proc.on("error", (e) => {
			this.startFailure = `The extension runtime could not be launched: ${e.message}`, this.failAllPending("SIDECAR_UNAVAILABLE", this.startFailure);
		});
		let a = await this.call("status", {}, 1e4);
		return a.ok ? (this.lastStatus = {
			canExecute: !!a.result?.canExecute,
			reason: a.result?.reason ? String(a.result.reason) : void 0,
			sandboxGaps: Array.isArray(a.result?.sandboxGaps) ? a.result.sandboxGaps : []
		}, !0) : (this.startFailure = a.error ?? "The extension runtime did not respond to a status probe.", !1);
	}
	resolveJava() {
		let e = process.platform === "win32" ? "java.exe" : "java", t = s.join(this.resourceDir, "jre", "bin", e);
		if (l.existsSync(t)) return t;
		let n = process.env.JAVA_HOME;
		if (n) {
			let t = s.join(n, "bin", e);
			if (l.existsSync(t)) return t;
		}
		return r?.isPackaged ? null : e;
	}
	onExit(e, t) {
		this.proc = null;
		let n = `exit code ${e ?? "none"}${t ? `, signal ${t}` : ""}`;
		this.failAllPending("SIDECAR_CRASHED", `The extension runtime stopped (${n}). A plugin can crash it; the app itself is unaffected.`), this.restarts++, this.restarts > Ce && (this.startFailure = `The extension runtime has crashed ${this.restarts} times this session and will not be restarted again. Extensions are unavailable until the app is restarted.`);
	}
	failAllPending(e, t) {
		for (let [, n] of this.pending) clearTimeout(n.timer), n.resolve({
			ok: !1,
			errorKind: e,
			error: t
		});
		this.pending.clear();
	}
	stop() {
		if (this.failAllPending("SIDECAR_STOPPED", "The extension runtime was shut down."), !this.proc) return;
		try {
			this.proc.stdin.end();
		} catch {}
		let e = this.proc;
		this.proc = null, setTimeout(() => {
			e.killed || e.kill();
		}, 2e3).unref();
	}
	onStdout(e) {
		this.stdoutBuffer += e;
		let t = this.stdoutBuffer.indexOf("\n");
		for (; t >= 0;) {
			let e = this.stdoutBuffer.slice(0, t).trim();
			this.stdoutBuffer = this.stdoutBuffer.slice(t + 1), e && this.onFrame(e), t = this.stdoutBuffer.indexOf("\n");
		}
	}
	onFrame(e) {
		let t;
		try {
			t = JSON.parse(e);
		} catch {
			console.warn(`[cs3-sidecar] unparsable frame: ${e.slice(0, 200)}`);
			return;
		}
		let n = String(t.id ?? ""), r = this.pending.get(n);
		r && (this.pending.delete(n), clearTimeout(r.timer), r.resolve({
			ok: !!t.ok,
			result: t.result,
			error: t.error,
			errorKind: t.errorKind
		}));
	}
	async call(e, t = {}, n = Se) {
		if (!this.proc || this.proc.killed) return {
			ok: !1,
			errorKind: "SIDECAR_UNAVAILABLE",
			error: this.startFailure ?? "The extension runtime is not running."
		};
		let r = String(this.nextId++), i = `${JSON.stringify({
			id: r,
			method: e,
			params: {
				...t,
				timeoutMs: n
			}
		})}\n`;
		return new Promise((t) => {
			let a = setTimeout(() => {
				this.pending.delete(r), t({
					ok: !1,
					errorKind: "TIMEOUT",
					error: `${e} did not return within ${n} ms.`
				});
			}, n + 2e3);
			this.pending.set(r, {
				resolve: t,
				timer: a,
				method: e
			});
			try {
				this.proc.stdin.write(i);
			} catch (e) {
				this.pending.delete(r), clearTimeout(a), t({
					ok: !1,
					errorKind: "SIDECAR_UNAVAILABLE",
					error: `Could not reach the extension runtime: ${e instanceof Error ? e.message : String(e)}`
				});
			}
		});
	}
	async status() {
		if (!await this.ensureStarted()) return {
			running: !1,
			canExecute: !1,
			reason: this.startFailure ?? "The extension runtime is unavailable.",
			sandboxGaps: [],
			restarts: this.restarts
		};
		let e = await this.call("ping", {}, 1e4);
		return {
			running: e.ok,
			canExecute: !!this.lastStatus?.canExecute,
			reason: this.lastStatus?.reason,
			javaVersion: e.result?.javaVersion ? String(e.result.javaVersion) : void 0,
			pid: typeof e.result?.pid == "number" ? e.result.pid : void 0,
			sandboxGaps: this.lastStatus?.sandboxGaps ?? [],
			restarts: this.restarts
		};
	}
}, Te = class e {
	pluginsDir;
	analyzer = new me();
	datastore;
	sidecar;
	installedRepoUrls = /* @__PURE__ */ new Set();
	installedPlugins = /* @__PURE__ */ new Map();
	runtimeReports = /* @__PURE__ */ new Map();
	constructor(e, t) {
		this.datastore = e, this.sidecar = t ?? new we(), this.pluginsDir = r ? s.join(r.getPath("userData"), "extensions") : s.join(process.cwd(), "extensions"), l.mkdirSync(this.pluginsDir, { recursive: !0 }), this.restore();
	}
	restore() {
		let e = this.datastore.getObject("installed_repositories_urls", []);
		if (Array.isArray(e)) for (let t of e) this.installedRepoUrls.add(t);
		let t = this.datastore.getObject("installed_plugins_list", []);
		if (Array.isArray(t)) for (let e of t) e?.internalName && this.installedPlugins.set(e.internalName, e);
	}
	persist() {
		this.datastore.setObject("installed_repositories_urls", [...this.installedRepoUrls]), this.datastore.setObject("installed_plugins_list", [...this.installedPlugins.values()]);
	}
	static sanitize(e) {
		return e.replace(/[\\/:*?"<>|]/g, "").trim();
	}
	static javaHashCode(e) {
		let t = 0;
		for (let n = 0; n < e.length; n++) t = Math.imul(31, t) + e.charCodeAt(n), t |= 0;
		return t;
	}
	installPathFor(t, n) {
		let r = `${e.sanitize(t)}.${e.javaHashCode(t)}`, i = `${e.sanitize(n)}.${e.javaHashCode(n)}.cs3`;
		return s.join(this.pluginsDir, r, i);
	}
	async fetchRepository(e) {
		let t = [], n = await _(e, { timeoutMs: 15e3 });
		if (Array.isArray(n)) {
			let r = n.filter((e) => e?.internalName && e.url);
			return r.length !== n.length && t.push(`${n.length - r.length} entries lacked an internalName or url.`), this.installedRepoUrls.add(e), this.persist(), {
				repositoryUrl: e,
				name: "Plugin list",
				description: "This URL is a plugin list rather than a repository document.",
				plugins: r,
				warnings: t
			};
		}
		if (!n || typeof n != "object" || !Array.isArray(n.pluginLists)) throw Error("Not a CloudStream repository: the document is neither a plugin array nor an object with a \"pluginLists\" array.");
		let r = await Promise.allSettled(n.pluginLists.map((e) => _(e, { timeoutMs: 15e3 }))), i = [];
		return r.forEach((e, r) => {
			if (e.status === "rejected") {
				t.push(`Plugin list ${n.pluginLists[r]} could not be read: ${e.reason instanceof Error ? e.reason.message : String(e.reason)}`);
				return;
			}
			if (!Array.isArray(e.value)) {
				t.push(`Plugin list ${n.pluginLists[r]} was not a JSON array.`);
				return;
			}
			for (let t of e.value) t?.internalName && t.url && i.push(t);
		}), this.installedRepoUrls.add(e), this.persist(), {
			repositoryUrl: e,
			name: n.name || "Unnamed repository",
			description: n.description,
			iconUrl: n.iconUrl,
			plugins: i,
			warnings: t
		};
	}
	getInstalledRepositories() {
		return [...this.installedRepoUrls];
	}
	removeRepository(e) {
		this.installedRepoUrls.delete(e), this.persist();
	}
	async installPlugin(e, t) {
		if (!e.url) return {
			ok: !1,
			message: "Plugin has no download URL."
		};
		let n = t ?? e.repositoryUrl ?? "unknown-repository", r = this.installPathFor(n, e.internalName), i = `${r}.tmp`;
		try {
			l.mkdirSync(s.dirname(r), { recursive: !0 });
			let t = await xe(e.url, { timeoutMs: 6e4 }), a = f.createHash("sha256").update(t).digest("hex");
			if (e.fileHash && e.fileHash.replace(/^sha256-/i, "").toLowerCase() !== a) return {
				ok: !1,
				message: "SHA-256 mismatch — the download does not match the hash the repository published. Install aborted."
			};
			if (l.writeFileSync(i, t), l.existsSync(r)) try {
				l.chmodSync(r, 438);
			} catch {}
			l.renameSync(i, r);
			let o = this.analyzer.analyzePlugin(e.name, e.internalName, r);
			this.installedPlugins.set(e.internalName, {
				internalName: e.internalName,
				url: e.url,
				isOnline: !0,
				filePath: r,
				version: e.version ?? 1,
				tier: o.recommendedTier,
				isEnabled: !0,
				meta: {
					...e,
					repositoryUrl: n
				}
			}), this.persist();
			let c = await this.inspect(e.internalName, r);
			return {
				ok: !0,
				report: o,
				message: c ? `${e.name} installed and verified. ${c.reason}` : `${e.name} installed and verified. The extension runtime is unavailable, so it could not be analysed.`
			};
		} catch (e) {
			try {
				l.existsSync(i) && l.unlinkSync(i);
			} catch {}
			return {
				ok: !1,
				message: e instanceof Error ? e.message : String(e)
			};
		}
	}
	uninstallPlugin(e) {
		let t = this.installedPlugins.get(e);
		if (!t) return !1;
		try {
			t.filePath && l.existsSync(t.filePath) && l.unlinkSync(t.filePath);
		} catch {}
		return this.installedPlugins.delete(e), this.persist(), !0;
	}
	getInstalledPlugins() {
		return [...this.installedPlugins.values()].map((e) => e.meta);
	}
	getInstalledPluginRecords() {
		return [...this.installedPlugins.values()];
	}
	analyzePlugin(e) {
		let t = this.installedPlugins.get(e.internalName);
		return this.analyzer.analyzePlugin(e.name, e.internalName, t?.filePath ?? e.url);
	}
	async inspect(e, t) {
		if (!await this.sidecar.ensureStarted()) return null;
		let n = await this.sidecar.call("inspect", {
			pluginId: e,
			path: t
		});
		if (!n.ok) {
			let t = {
				tier: "T4_BLOCKED",
				reason: n.error ?? "The extension runtime could not analyse this plugin.",
				translated: !1,
				failureKind: n.errorKind
			};
			return this.runtimeReports.set(e, t), t;
		}
		let r = n.result ?? {}, i = {
			tier: String(r.tier ?? "T4_BLOCKED"),
			reason: String(r.reason ?? ""),
			translated: !!r.translated,
			classCount: typeof r.classCount == "number" ? r.classCount : void 0,
			dexCount: typeof r.dexCount == "number" ? r.dexCount : void 0,
			entryClass: r.entryClass ? String(r.entryClass) : void 0,
			unresolvedCritical: Array.isArray(r.unresolvedCritical) ? r.unresolvedCritical : void 0,
			unresolvedAndroid: Array.isArray(r.unresolvedAndroid) ? r.unresolvedAndroid : void 0,
			failureKind: r.failureKind ? String(r.failureKind) : void 0
		};
		return this.runtimeReports.set(e, i), i;
	}
	getRuntimeReport(e) {
		return this.runtimeReports.get(e) ?? null;
	}
	async getRuntimeStatus() {
		let e = await this.sidecar.status();
		return {
			available: e.running && e.canExecute,
			installedCount: this.installedPlugins.size,
			reason: e.running ? e.canExecute ? "The extension runtime is running and can execute installed extensions." : e.reason ?? "The extension runtime is running but the CloudStream provider API is not on its classpath, so extensions cannot be executed." : e.reason ?? "The extension runtime is not available.",
			javaVersion: e.javaVersion,
			sandboxGaps: e.sandboxGaps
		};
	}
	shutdown() {
		this.sidecar.stop();
	}
	getProvidersList() {
		return [];
	}
	async searchAll(e) {
		return [];
	}
	async loadMedia(e) {
		return null;
	}
	async loadLinks(e) {
		return [];
	}
}, Ee = class {
	binDir;
	constructor() {
		this.binDir = r ? s.join(r.getPath("userData"), "bin") : s.join(process.cwd(), "bin"), l.existsSync(this.binDir) || l.mkdirSync(this.binDir, { recursive: !0 });
	}
	getBinDir() {
		return this.binDir;
	}
	checkBinaries() {
		let e = s.join(this.binDir, process.platform === "win32" ? "aria2c.exe" : "aria2c"), t = s.join(this.binDir, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp"), n = s.join(process.cwd(), "bin", process.platform === "win32" ? "aria2c.exe" : "aria2c"), r = s.join(process.cwd(), "bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
		return {
			aria2: l.existsSync(e) || l.existsSync(n),
			ytdlp: l.existsSync(t) || l.existsSync(r)
		};
	}
	async downloadFile(e, t, n) {
		return new Promise((r) => {
			let i = l.createWriteStream(t);
			(e.startsWith("https") ? ee : p).get(e, { headers: { "User-Agent": "CloudStreamDesktop/1.0" } }, (e) => {
				if ((e.statusCode === 301 || e.statusCode === 302) && e.headers.location) return i.close(), this.downloadFile(e.headers.location, t, n).then(r);
				let a = parseInt(e.headers["content-length"] || "0", 10), o = 0;
				e.on("data", (e) => {
					o += e.length, i.write(e), a > 0 && n && n(Math.floor(o / a * 100));
				}), e.on("end", () => {
					i.on("finish", () => {
						r(!0);
					}), i.end();
				});
			}).on("error", (e) => {
				if (console.error("Binary download error:", e), i.close(), l.existsSync(t)) try {
					l.unlinkSync(t);
				} catch {}
				r(!1);
			});
		});
	}
	async setupAria2(e) {
		let t = process.platform === "win32" ? "aria2c.exe" : "aria2c", n = s.join(this.binDir, t);
		if (l.existsSync(n)) return !0;
		e && e("Downloading portable aria2c binary...", 20);
		let r = s.join(this.binDir, "aria2.zip");
		if (!await this.downloadFile("https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip", r, (t) => {
			e && e(`Downloading aria2c engine... ${t}%`, Math.floor(20 + t * .5));
		}) || !l.existsSync(r)) return e && e("Downloading via mirror engine...", 50), await this.downloadFile("https://raw.githubusercontent.com/dipenparmar12/cs3/main/bin/aria2c.exe", n, (t) => {
			e && e(`Configuring aria2c... ${t}%`, t);
		}), l.existsSync(n);
		e && e("Extracting aria2c binary...", 80);
		try {
			u.execSync(`powershell -command "Expand-Archive -Path '${r}' -DestinationPath '${this.binDir}' -Force"`);
			let e = l.readdirSync(this.binDir, { recursive: !0 });
			for (let t of e) {
				let e = s.join(this.binDir, String(t));
				if (s.basename(e).toLowerCase() === "aria2c.exe") {
					l.copyFileSync(e, n);
					break;
				}
			}
			if (l.existsSync(r)) try {
				l.unlinkSync(r);
			} catch {}
		} catch (e) {
			console.warn("Extraction fallback:", e);
		}
		return e && e("aria2c engine configured successfully!", 100), l.existsSync(n);
	}
	async setupYtDlp(e) {
		let t = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp", n = s.join(this.binDir, t);
		return l.existsSync(n) ? !0 : (e && e("Downloading portable yt-dlp fallback engine...", 30), await this.downloadFile("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe", n, (t) => {
			e && e(`Configuring yt-dlp... ${t}%`, Math.floor(30 + t * .7));
		}), e && e("yt-dlp configured successfully!", 100), l.existsSync(n));
	}
}, De = /* @__PURE__ */ JSON.parse("[{\"id\":\"megarepo\",\"name\":\"MegaRepo\",\"internalName\":\"MegaRepo\",\"description\":\"Official CloudStream Mega Repository containing unified multi-provider extractors and high-speed mirrors.\",\"url\":\"https://github.com/self-similarity/MegaRepo\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/self-similarity/MegaRepo/builds/repo.json\",\"category\":\"Official\",\"language\":\"Multilingual\",\"iconUrl\":\"https://raw.githubusercontent.com/recloudstream/cloudstream/master/app/src/main/res/drawable/ic_splash_logo.png\",\"verified\":true,\"documentKind\":\"repository\"},{\"id\":\"extensions\",\"name\":\"Official Extensions\",\"internalName\":\"extensions\",\"description\":\"Primary CloudStream Community Extensions Repository covering popular movies, TV series, and anime.\",\"url\":\"https://github.com/recloudstream/extensions\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/recloudstream/extensions/master/repo.json\",\"category\":\"Official\",\"language\":\"English / Global\",\"verified\":true,\"documentKind\":\"repository\"},{\"id\":\"aniyomi_compat\",\"name\":\"Aniyomi Compatibility Repo\",\"internalName\":\"AniyomiCompatExtension\",\"description\":\"Aniyomi & Tachiyomi extension bridge adapter, enabling playback from Aniyomi provider sources.\",\"url\":\"https://github.com/CranberrySoup/AniyomiCompatExtension\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/CranberrySoup/AniyomiCompatExtension/master/repo.json\",\"category\":\"Compatibility\",\"language\":\"Multilingual\",\"verified\":true,\"documentKind\":\"repository\"},{\"id\":\"german_providers\",\"name\":\"German Providers\",\"internalName\":\"GermanProviders\",\"description\":\"German language streaming providers including Movie4k, Kinox, AniWorld, and SerienStream.\",\"url\":\"https://github.com/Bnyro/GermanProviders\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/Bnyro/GermanProviders/master/repo.json\",\"category\":\"Regional\",\"language\":\"German (DE)\",\"verified\":true,\"documentKind\":\"repository\"},{\"id\":\"italia_in_streaming\",\"name\":\"Italia In Streaming\",\"internalName\":\"ItaliaInStreaming\",\"description\":\"Italian language movie and anime providers including CB01, Filmpertutti, and StreamingCommunity.\",\"url\":\"https://github.com/DieGon7771/ItaliaInStreaming\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/DieGon7771/ItaliaInStreaming/builds/repo.json\",\"category\":\"Regional\",\"language\":\"Italian (IT)\",\"verified\":true,\"documentKind\":\"repository\"},{\"id\":\"re_3arabi\",\"name\":\"Arabic Media Repo (re-3arabi)\",\"internalName\":\"re-3arabi\",\"description\":\"Arabic language streaming extractors including EgyBest, Shahid4u, FaselHD, and CimaClub.\",\"url\":\"https://github.com/Abodabodd/re-3arabi\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/Abodabodd/re-3arabi/master/repo.json\",\"category\":\"Regional\",\"language\":\"Arabic (AR)\",\"verified\":true,\"documentKind\":\"repository\"},{\"id\":\"cloudstream_vietnamese\",\"name\":\"Vietnamese Providers\",\"internalName\":\"cloudstream-vietnamese\",\"description\":\"Vietnamese language media providers including PhimMoi, Motphim, and Bilutv.\",\"url\":\"https://gitlab.com/tearrs/cloudstream-vietnamese\",\"rawRepoUrl\":\"https://gitlab.com/tearrs/cloudstream-vietnamese/-/raw/main/repo.json\",\"category\":\"Regional\",\"language\":\"Vietnamese (VI)\",\"verified\":true,\"documentKind\":\"repository\"},{\"id\":\"csx\",\"name\":\"CloudStream X (CSX)\",\"internalName\":\"CSX\",\"description\":\"High-performance premium stream extractors and fast direct link resolvers.\",\"url\":\"https://github.com/SaurabhKaperwan/CSX\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/SaurabhKaperwan/CSX/builds/plugins.json\",\"category\":\"Community\",\"language\":\"English\",\"verified\":true,\"documentKind\":\"pluginList\"},{\"id\":\"cuxplug\",\"name\":\"CuxPlug Repo\",\"internalName\":\"CuxPlug\",\"description\":\"Cux custom extension pack providing multi-server link extraction.\",\"url\":\"https://github.com/ycngmn/CuxPlug\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/ycngmn/CuxPlug/master/repo.json\",\"category\":\"Community\",\"language\":\"English\",\"verified\":true,\"documentKind\":\"repository\"},{\"id\":\"fstream\",\"name\":\"FStream French Repo\",\"internalName\":\"FStream\",\"description\":\"French language streaming providers including FrenchStream, Wawacity, and VoirAnime.\",\"url\":\"https://git.disroot.org/ayza/FStream\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/recloudstream/FStream/builds/repo.json\",\"category\":\"Regional\",\"language\":\"French (FR)\",\"verified\":false,\"documentKind\":\"unknown\"},{\"id\":\"indostream\",\"name\":\"IndoStream Repo\",\"internalName\":\"IndoStream\",\"description\":\"Indonesian language streaming providers including Idlix and LK21.\",\"url\":\"https://github.com/TeKuma25/IndoStream\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/TeKuma25/IndoStream/builds/repo.json\",\"category\":\"Regional\",\"language\":\"Indonesian (ID)\",\"verified\":true,\"documentKind\":\"repository\"},{\"id\":\"luna712\",\"name\":\"Luna712 Extensions\",\"internalName\":\"Luna712-CloudStream-Extensions\",\"description\":\"Luna712 curated anime & multi-source high-bitrate extractors.\",\"url\":\"https://github.com/Luna712/Luna712-CloudStream-Extensions\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/Luna712/Luna712-CloudStream-Extensions/master/repo.json\",\"category\":\"Anime\",\"language\":\"Multilingual\",\"verified\":true,\"documentKind\":\"repository\"},{\"id\":\"cartoonyrepo\",\"name\":\"Cartoony Repo\",\"internalName\":\"cartoonyrepo\",\"description\":\"Cartoons, Animated Shows, and Kids Media specialized repository.\",\"url\":\"https://github.com/med1245/cartoonyrepo\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/med1245/cartoonyrepo/builds/repo.json\",\"category\":\"Movies & Shows\",\"language\":\"English\",\"verified\":true,\"documentKind\":\"repository\"},{\"id\":\"cinephile\",\"name\":\"Cinephile Repo\",\"internalName\":\"cinephile\",\"description\":\"Cinephile Movies & Shows high-bitrate 4K/1080p stream extractors.\",\"url\":\"https://github.com/rockhero1234/cinephile\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/rockhero1234/cinephile/builds/repo.json\",\"category\":\"Movies & Shows\",\"language\":\"English\",\"verified\":true,\"documentKind\":\"repository\"},{\"id\":\"redowan\",\"name\":\"Redowan CloudStream Repo\",\"internalName\":\"Redowan-CloudStream\",\"description\":\"Redowan community extension collection for movies, anime, and live TV.\",\"url\":\"https://github.com/redowan99/Redowan-CloudStream\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/redowan99/Redowan-CloudStream/master/repo.json\",\"category\":\"Community\",\"language\":\"Multilingual\",\"verified\":true,\"documentKind\":\"repository\"},{\"id\":\"uk_extensions\",\"name\":\"UK Extensions\",\"internalName\":\"cloudstream-extensions-uk\",\"description\":\"United Kingdom & English language media providers and BBC/ITV resolvers.\",\"url\":\"https://github.com/CakesTwix/cloudstream-extensions-uk\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/CakesTwix/cloudstream-extensions-uk/master/repo.json\",\"category\":\"Regional\",\"language\":\"English (UK)\",\"verified\":true,\"documentKind\":\"repository\"},{\"id\":\"storm_ext\",\"name\":\"Storm Extensions\",\"internalName\":\"storm-ext\",\"description\":\"Storm fast extractors and direct video link resolvers.\",\"url\":\"https://github.com/redblacker8/storm-ext\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/redblacker8/storm-ext/builds/repo.json\",\"category\":\"Community\",\"language\":\"English\",\"verified\":true,\"documentKind\":\"repository\"},{\"id\":\"reflex_repo\",\"name\":\"Reflex Repo\",\"internalName\":\"ReflexRepo\",\"description\":\"Reflex high-speed mirror resolvers and multi-host extractors.\",\"url\":\"https://github.com/Reflex755/ReflexRepo\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/Reflex755/ReflexRepo/builds/repo.json\",\"category\":\"Community\",\"language\":\"English\",\"verified\":true,\"documentKind\":\"repository\"},{\"id\":\"pitipitii\",\"name\":\"Pitipitii Repo\",\"internalName\":\"Pitipitii\",\"description\":\"Pitipitii custom extension pack.\",\"url\":\"https://github.com/sarapcanagii/Pitipitii\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/sarapcanagii/Pitipitii/master/repo.json\",\"category\":\"Community\",\"language\":\"Multilingual\",\"verified\":true,\"documentKind\":\"repository\"},{\"id\":\"cs_karma\",\"name\":\"Karma Repo\",\"internalName\":\"cs-Karma\",\"description\":\"Karma community provider collection.\",\"url\":\"https://github.com/Kraptor123/cs-Karma\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/Kraptor123/cs-Karma/master/repo.json\",\"category\":\"Community\",\"language\":\"English\",\"verified\":true,\"documentKind\":\"repository\"},{\"id\":\"cs_kraptor\",\"name\":\"Kraptor Repo\",\"internalName\":\"cs-kraptor\",\"description\":\"Kraptor media extractors.\",\"url\":\"https://github.com/Kraptor123/cs-kraptor\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/Kraptor123/cs-kraptor/master/repo.json\",\"category\":\"Community\",\"language\":\"English\",\"verified\":true,\"documentKind\":\"repository\"},{\"id\":\"dogiors\",\"name\":\"doGiors Repo\",\"internalName\":\"doGiorsHadEnough\",\"description\":\"doGiors custom provider extensions.\",\"url\":\"https://github.com/doGior/doGiorsHadEnough\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/doGior/doGiorsHadEnough/builds/repo.json\",\"category\":\"Community\",\"language\":\"English\",\"verified\":true,\"documentKind\":\"repository\"},{\"id\":\"phisher\",\"name\":\"Phisher Extensions\",\"internalName\":\"cloudstream-extensions-phisher\",\"description\":\"Phisher community media extensions.\",\"url\":\"https://github.com/phisher98/cloudstream-extensions-phisher\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/phisher98/cloudstream-extensions-phisher/builds/repo.json\",\"category\":\"Community\",\"language\":\"English\",\"verified\":true,\"documentKind\":\"repository\"},{\"id\":\"skillshare\",\"name\":\"SkillShare Repo\",\"internalName\":\"SkillShare-Repo\",\"description\":\"Educational & documentary video content providers.\",\"url\":\"https://github.com/techtanic/SkillShare-Repo\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/techtanic/SkillShare-Repo/builds/repo.json\",\"category\":\"Community\",\"language\":\"English\",\"verified\":true,\"documentKind\":\"repository\"},{\"id\":\"saimuelrepo\",\"name\":\"Saimuel Repo\",\"internalName\":\"saimuelrepo\",\"description\":\"Saimuel curated extensions.\",\"url\":\"https://github.com/saimuelbr/saimuelrepo\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/saimuelbr/saimuelrepo/builds/repo.json\",\"category\":\"Community\",\"language\":\"English\",\"verified\":false,\"documentKind\":\"unknown\"},{\"id\":\"italian_provider\",\"name\":\"Italian Dedicated Provider\",\"internalName\":\"ItalianProvider\",\"description\":\"Italian dedicated anime and movie providers.\",\"url\":\"https://github.com/Gian-Fr/ItalianProvider\",\"rawRepoUrl\":\"https://raw.githubusercontent.com/Gian-Fr/ItalianProvider/builds/repo.json\",\"category\":\"Regional\",\"language\":\"Italian (IT)\",\"verified\":true,\"documentKind\":\"repository\"}]"), y = {
	UHD_4K: 2160,
	QHD: 1440,
	FHD: 1080,
	HD: 720,
	SD: 480,
	LD: 360,
	Unknown: 0
}, b = {
	Remux: "Remux",
	BluRay: "BluRay",
	WebDL: "WEB-DL",
	WebRip: "WEBRip",
	HDTV: "HDTV",
	DVDRip: "DVDRip",
	SCR: "SCR",
	TS: "TS",
	CAM: "CAM",
	Unknown: "Unknown"
}, x = {
	AV1: "AV1",
	H265: "x265",
	H264: "x264",
	XviD: "XviD",
	VP9: "VP9",
	Unknown: "Unknown"
}, S = {
	Builtin: "builtin",
	Torznab: "torznab"
}, Oe = {
	preferredResolution: y.FHD,
	minResolution: y.Unknown,
	minSeeders: 1,
	excludeLowQualitySources: !0,
	preferH264: !1,
	preferredLanguages: ["en"],
	preferHDR: !1,
	preferredGroups: [],
	blockedGroups: [],
	blockedKeywords: []
}, ke = /[._]+/g, Ae = /[[\](){}]/g, je = [
	[/\bremux\b/i, b.Remux],
	[/\b(?:bluray|blu-ray|bdrip|brrip|bdremux|bd25|bd50|bdmv)\b/i, b.BluRay],
	[/\b(?:web-?dl|webdl|amzn|nf|dsnp|hmax|atvp|itunes)\b/i, b.WebDL],
	[/\b(?:web-?rip|webrip)\b/i, b.WebRip],
	[/\bweb\b/i, b.WebDL],
	[/\b(?:hdtv|pdtv|sdtv|dvbrip|tvrip)\b/i, b.HDTV],
	[/\b(?:dvdrip|dvd-?r|dvd5|dvd9|ntsc|pal)\b/i, b.DVDRip],
	[/\b(?:screener|scr|dvdscr|bdscr)\b/i, b.SCR],
	[/\b(?:hdts|telesync|ts)\b/i, b.TS],
	[/\b(?:hdcam|camrip|cam|telecine|tc)\b/i, b.CAM]
], Me = [
	[/\bav1\b/i, x.AV1],
	[/\b(?:x[\s.]?265|h[\s.]?265|hevc)\b/i, x.H265],
	[/\b(?:x[\s.]?264|h[\s.]?264|avc)\b/i, x.H264],
	[/\b(?:xvid|divx)\b/i, x.XviD],
	[/\bvp9\b/i, x.VP9]
], Ne = [
	[/\b(?:2160p?|4k|uhd|3840x2160)\b/i, y.UHD_4K],
	[/\b(?:1440p?|2560x1440|qhd)\b/i, y.QHD],
	[/\b(?:1080[pi]?|1920x1080|fhd)\b/i, y.FHD],
	[/\b(?:720p?|1280x720)\b/i, y.HD],
	[/\b(?:480[pi]?|640x480|sd)\b/i, y.SD],
	[/\b(?:360p?|240p?)\b/i, y.LD]
], Pe = [
	[/\batmos\b/i, "Atmos"],
	[/\btruehd\b/i, "TrueHD"],
	[/\bdts-?hd(?:\s*ma)?\b/i, "DTS-HD"],
	[/\bdts-?x\b/i, "DTS-X"],
	[/\bdts\b/i, "DTS"],
	[/\b(?:ddp|eac-?3|e-?ac-?3|dd\+)\d*\b/i, "EAC3"],
	[/\b(?:dd(?!p)(?!\+)|ac-?3)\d*\b/i, "AC3"],
	[/\bflac\d*\b/i, "FLAC"],
	[/\bopus\b/i, "Opus"],
	[/\baac\d*\b/i, "AAC"],
	[/\bmp3\b/i, "MP3"]
], Fe = [
	[/\bhdr10\+|\bhdr10plus\b/i, "HDR10+"],
	[/\bhdr10\b/i, "HDR10"],
	[/\b(?:dolby\s*vision|dovi|\bdv\b)\b/i, "DV"],
	[/\bhlg\b/i, "HLG"],
	[/\bhdr\b/i, "HDR"]
], Ie = [
	[/\b(?:english|eng)\b/i, "en"],
	[/\b(?:spanish|espanol|castellano|latino|esp)\b/i, "es"],
	[/\b(?:french|francais|vostfr|truefrench|vff|vfq)\b/i, "fr"],
	[/\b(?:german|deutsch|ger)\b/i, "de"],
	[/\b(?:italian|ita)\b/i, "it"],
	[/\b(?:portuguese|dublado|legendado|por)\b/i, "pt"],
	[/\b(?:russian|rus)\b/i, "ru"],
	[/\b(?:japanese|jap|jpn)\b/i, "ja"],
	[/\b(?:korean|kor)\b/i, "ko"],
	[/\b(?:chinese|mandarin|cantonese|chs|cht)\b/i, "zh"],
	[/\b(?:hindi|hin)\b/i, "hi"],
	[/\b(?:tamil|tam)\b/i, "ta"],
	[/\b(?:telugu|tel)\b/i, "te"],
	[/\b(?:arabic|ara)\b/i, "ar"],
	[/\b(?:turkish|tur)\b/i, "tr"],
	[/\b(?:polish|pol|lektor)\b/i, "pl"],
	[/\b(?:dutch|nld)\b/i, "nl"],
	[/\b(?:thai|tha)\b/i, "th"],
	[/\b(?:indonesian|ind)\b/i, "id"],
	[/\b(?:vietnamese|vie)\b/i, "vi"],
	[/\b(?:ukrainian|ukr)\b/i, "uk"]
], Le = new RegExp([
	String.raw`\b(19|20)\d{2}\b`,
	String.raw`\bs\d{1,3}(?:\s*[-–]\s*s?\d{1,3})?\b`,
	String.raw`\bs\d{1,3}\s*e\d{1,4}\b`,
	String.raw`\b\d{1,2}x\d{1,3}\b`,
	String.raw`\bseason\b`,
	String.raw`\b(?:2160|1440|1080|720|480|360)[pi]?\b`,
	String.raw`\b(?:4k|uhd|fhd)\b`,
	String.raw`\b(?:bluray|blu-ray|bdrip|brrip|web-?dl|webrip|web|hdtv|dvdrip|remux|hdcam|cam|hdts|telesync)\b`,
	String.raw`\b(?:x[\s.]?26[45]|h[\s.]?26[45]|hevc|avc|av1|xvid|divx)\b`,
	String.raw`\bcomplete\b`
].join("|"), "i");
function Re(e) {
	return e.replace(ke, " ").replace(Ae, " ").replace(/\s+/g, " ").trim();
}
function C(e, t, n) {
	for (let [n, r] of t) if (n.test(e)) return r;
	return n;
}
function w(e, t) {
	let n = [];
	for (let [r, i] of t) r.test(e) && !n.includes(i) && n.push(i);
	return n;
}
function ze(e) {
	let t = e.match(/^\[([^\]]{2,30})\]/);
	if (t) return t[1].trim();
	let n = e.match(/-\s*([A-Za-z0-9_.]{2,25})(?:\.[a-z0-9]{2,4})?\s*$/);
	if (n) {
		let e = n[1].replace(/\.(mkv|mp4|avi|ts|m2ts)$/i, "").trim();
		if (!/^(?:2160p?|1080p?|720p?|480p?|x26[45]|h26[45]|hevc|av1)$/i.test(e)) return e;
	}
}
function Be(e) {
	let t = /\b(?:complete|full)\s*(?:series|collection)\b/i.test(e), n = e.match(/\bs(?:eason)?\s*(\d{1,3})\s*[-–]\s*s?(?:eason)?\s*(\d{1,3})\b/i);
	if (n) return {
		season: parseInt(n[1], 10),
		isSeasonPack: !0,
		isCompleteSeries: !0
	};
	let r = e.match(/\bs(\d{1,3})\s*e(\d{1,4})\s*[-–]\s*e?(\d{1,4})\b/i);
	if (r) return {
		season: parseInt(r[1], 10),
		episode: parseInt(r[2], 10),
		isSeasonPack: !0,
		isCompleteSeries: !1
	};
	let i = e.match(/\bs(\d{1,3})\s*[.\-_ ]?\s*e(\d{1,4})\b/i);
	if (i) return {
		season: parseInt(i[1], 10),
		episode: parseInt(i[2], 10),
		isSeasonPack: !1,
		isCompleteSeries: !1
	};
	let a = e.match(/\b(\d{1,2})x(\d{1,3})\b/i);
	if (a) return {
		season: parseInt(a[1], 10),
		episode: parseInt(a[2], 10),
		isSeasonPack: !1,
		isCompleteSeries: !1
	};
	let o = e.match(/\bseason\s*(\d{1,3})\s*episode\s*(\d{1,4})\b/i);
	if (o) return {
		season: parseInt(o[1], 10),
		episode: parseInt(o[2], 10),
		isSeasonPack: !1,
		isCompleteSeries: !1
	};
	let s = e.match(/\bs(?:eason)?\s*(\d{1,3})\b/i);
	if (s) return {
		season: parseInt(s[1], 10),
		isSeasonPack: !0,
		isCompleteSeries: t
	};
	let c = e.match(/\s-\s(\d{1,4})(?:v\d)?\b/);
	if (c) {
		let e = parseInt(c[1], 10);
		if (e > 0 && e < 2e3) return {
			absoluteEpisode: e,
			episode: e,
			isSeasonPack: !1,
			isCompleteSeries: t
		};
	}
	let l = e.match(/\be(?:p|pisode)?\s*(\d{1,4})\b/i);
	return l ? {
		episode: parseInt(l[1], 10),
		isSeasonPack: !1,
		isCompleteSeries: t
	} : {
		isSeasonPack: t,
		isCompleteSeries: t
	};
}
function Ve(e) {
	let t = [...e.matchAll(/\b(19\d{2}|20\d{2})\b/g)].map((e) => parseInt(e[1], 10));
	if (t.length === 0) return;
	let n = (/* @__PURE__ */ new Date()).getFullYear(), r = t.filter((e) => e >= 1900 && e <= n + 2);
	return r.length > 0 ? r[0] : void 0;
}
function He(e) {
	let t = e.match(Le);
	return (t && t.index !== void 0 ? e.slice(0, t.index) : e).replace(/^\[[^\]]*\]\s*/, "").replace(/[-–\s]+$/, "").replace(/\s+/g, " ").trim();
}
function T(e) {
	let t = Re(e), n = Be(t);
	return {
		cleanTitle: He(t),
		year: Ve(t),
		season: n.season,
		episode: n.episode,
		absoluteEpisode: n.absoluteEpisode,
		isSeasonPack: n.isSeasonPack,
		isCompleteSeries: n.isCompleteSeries,
		resolution: C(t, Ne, y.Unknown),
		source: C(t, je, b.Unknown),
		videoCodec: C(t, Me, x.Unknown),
		audioCodecs: w(t, Pe),
		hdr: w(t, Fe),
		languages: w(t, Ie),
		isMultiAudio: /\b(?:multi|multi-?audio|dual)\b/i.test(t),
		isDualAudio: /\bdual\s*-?\s*audio\b/i.test(t),
		hasHardcodedSubs: /\b(?:hardsub|hc|hardcoded)\b/i.test(t),
		isRepack: /\brepack\b/i.test(t),
		isProper: /\bproper\b/i.test(t),
		isRemastered: /\bremaster(?:ed)?\b/i.test(t),
		is3D: /\b3d\b|\bhsbs\b|\bhou\b/i.test(t),
		releaseGroup: ze(e)
	};
}
function E(e) {
	return e.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\b(?:the|a|an)\b/g, " ").replace(/\s+/g, " ").trim();
}
function Ue(e, t) {
	let n = new Set(E(e).split(" ").filter(Boolean)), r = new Set(E(t).split(" ").filter(Boolean));
	if (n.size === 0 || r.size === 0) return 0;
	let i = 0;
	for (let e of n) r.has(e) && i++;
	return 2 * i / (n.size + r.size);
}
function We(e, t, n) {
	return t === void 0 && n === void 0 || e.isCompleteSeries ? !0 : t !== void 0 && e.season !== void 0 && e.season !== t ? !1 : e.isSeasonPack ? t === void 0 || e.season === t : n !== void 0 && e.episode !== void 0 ? e.episode === n : e.absoluteEpisode !== void 0 || t !== void 0 && e.season === t;
}
//#endregion
//#region electron/torrent/indexers/base.ts
var Ge = [
	"udp://tracker.opentrackr.org:1337/announce",
	"udp://open.demonii.com:1337/announce",
	"udp://open.stealth.si:80/announce",
	"udp://tracker.torrent.eu.org:451/announce",
	"udp://exodus.desync.com:6969/announce",
	"udp://tracker.openbittorrent.com:6969/announce",
	"udp://explodie.org:6969/announce",
	"udp://tracker.opentrackr.org:1337",
	"wss://tracker.openwebtorrent.com"
], Ke = /\b([a-f0-9]{40})\b/i, qe = /\b([a-z2-7]{32})\b/i;
function D(e) {
	let t = e.match(/xt=urn:btih:([^&]+)/i);
	if (!t) return;
	let n = decodeURIComponent(t[1]);
	if (Ke.test(n)) return n.toLowerCase();
	if (qe.test(n)) try {
		return Je(n.toUpperCase());
	} catch {
		return;
	}
}
function Je(e) {
	let t = "";
	for (let n of e) {
		let e = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(n);
		if (e < 0) throw Error(`Invalid base32 character: ${n}`);
		t += e.toString(2).padStart(5, "0");
	}
	let n = "";
	for (let e = 0; e + 4 <= t.length; e += 4) n += parseInt(t.slice(e, e + 4), 2).toString(16);
	return n.toLowerCase().slice(0, 40);
}
function O(e, t) {
	let n = [`xt=urn:btih:${e.toLowerCase()}`];
	t && n.push(`dn=${encodeURIComponent(t)}`);
	for (let e of Ge) n.push(`tr=${encodeURIComponent(e)}`);
	return `magnet:?${n.join("&")}`;
}
function k(e) {
	if (typeof e == "number" && Number.isFinite(e)) return e;
	if (!e) return 0;
	let t = String(e).trim();
	if (/^\d+$/.test(t)) return parseInt(t, 10);
	let n = t.match(/([\d.,]+)\s*([kmgt]?i?b)/i);
	if (!n) return 0;
	let r = parseFloat(n[1].replace(/,/g, ""));
	if (!Number.isFinite(r)) return 0;
	let i = n[2].toLowerCase();
	return Math.round(r * ({
		b: 1,
		kb: 1e3,
		kib: 1024,
		mb: 1e6,
		mib: 1024 ** 2,
		gb: 1e9,
		gib: 1024 ** 3,
		tb: 0xe8d4a51000,
		tib: 1024 ** 4
	}[i] ?? 1));
}
function A(e, t = 0) {
	let n = typeof e == "number" ? e : parseInt(String(e ?? ""), 10);
	return Number.isFinite(n) && n >= 0 ? n : t;
}
function Ye(e, t) {
	let n = e.infoHash?.toLowerCase(), r = e.magnet;
	return !n && r && (n = D(r)), n && !r && (r = O(n, e.title)), !n || !r ? e.torrentUrl ? {
		infoHash: n ?? "",
		title: e.title,
		magnet: r ?? "",
		torrentUrl: e.torrentUrl,
		sizeBytes: e.sizeBytes ?? 0,
		seeders: e.seeders ?? 0,
		leechers: e.leechers ?? 0,
		indexerId: t.id,
		indexerName: t.name,
		publishedAt: e.publishedAt,
		category: e.category,
		fileIndex: e.fileIndex,
		expectedFileName: e.expectedFileName,
		parsed: T(e.expectedFileName || e.title),
		score: 0,
		scoreReasons: []
	} : null : /^[a-f0-9]{40}$/.test(n) ? {
		infoHash: n,
		title: e.title,
		magnet: r,
		torrentUrl: e.torrentUrl,
		sizeBytes: e.sizeBytes ?? 0,
		seeders: e.seeders ?? 0,
		leechers: e.leechers ?? 0,
		indexerId: t.id,
		indexerName: t.name,
		publishedAt: e.publishedAt,
		category: e.category,
		fileIndex: e.fileIndex,
		expectedFileName: e.expectedFileName,
		parsed: T(e.expectedFileName || e.title),
		score: 0,
		scoreReasons: []
	} : null;
}
//#endregion
//#region electron/torrent/torrentEngine.ts
var Xe = /* @__PURE__ */ new Set([
	".mp4",
	".mkv",
	".avi",
	".mov",
	".m4v",
	".wmv",
	".flv",
	".webm",
	".mpg",
	".mpeg",
	".m2ts",
	".ts",
	".ogv",
	".3gp",
	".divx",
	".vob"
]), Ze = /* @__PURE__ */ new Set([
	".srt",
	".ass",
	".ssa",
	".vtt",
	".sub",
	".idx"
]), Qe = 8388608, $e = 45e3;
function j(e) {
	return s.extname(e).toLowerCase();
}
function M(e) {
	return Xe.has(j(e.name));
}
function et(e) {
	switch (e) {
		case ".mp4":
		case ".m4v": return "video/mp4";
		case ".webm": return "video/webm";
		case ".ogv": return "video/ogg";
		case ".mkv": return "video/x-matroska";
		default: return "video/mp4";
	}
}
var tt = class {
	client = null;
	server = null;
	serverPort = 0;
	downloadPath;
	selectedFile = /* @__PURE__ */ new Map();
	lastError = /* @__PURE__ */ new Map();
	constructor(e) {
		this.downloadPath = e ?? s.join(te.tmpdir(), "cloudstream-desktop", "torrent-cache");
	}
	setDownloadPath(e) {
		this.downloadPath = e;
	}
	async ensureStarted() {
		return this.client && !this.client.destroyed && this.server && this.serverPort > 0 ? {
			client: this.client,
			port: this.serverPort
		} : (l.mkdirSync(this.downloadPath, { recursive: !0 }), this.client = new ne({
			maxConns: 100,
			dht: !0,
			lsd: !0,
			webSeeds: !0
		}), this.client.on("error", (e) => {
			console.error("[torrent] client error:", e instanceof Error ? e.message : e);
		}), this.server = this.client.createServer({ pathname: "/webtorrent" }, "node"), this.serverPort = await new Promise((e, t) => {
			let n = this.server;
			if (!n) return t(/* @__PURE__ */ Error("Failed to create torrent server"));
			n.server.once("error", t), n.listen(0, "127.0.0.1", () => {
				let r = n.address();
				r && typeof r == "object" ? e(r.port) : t(/* @__PURE__ */ Error("Torrent server did not report a port"));
			});
		}), {
			client: this.client,
			port: this.serverPort
		});
	}
	pickFile(e, t) {
		let n = e.files.filter(M);
		if (n.length === 0) return null;
		if (n.length === 1) return n[0];
		if (t.expectedFileName) {
			let e = t.expectedFileName.toLowerCase(), r = n.find((t) => t.name.toLowerCase() === e || t.path.toLowerCase().endsWith(e));
			if (r) return r;
		}
		if (t.fileIndex !== void 0) {
			let n = e.files[t.fileIndex];
			if (n && M(n)) return n;
		}
		if (t.episode !== void 0) {
			let e = n.filter((e) => {
				let n = T(e.name);
				return t.season !== void 0 && n.season !== void 0 && n.season !== t.season ? !1 : n.episode === t.episode || n.absoluteEpisode === t.episode;
			});
			if (e.length > 0) return e.reduce((e, t) => t.length > e.length ? t : e);
		}
		return n.reduce((e, t) => t.length > e.length ? t : e);
	}
	focusOn(e, t) {
		for (let n of e.files) if (n !== t) try {
			n.deselect();
		} catch {}
		t.select(1);
	}
	fileUrl(e, t, n) {
		return `http://127.0.0.1:${e}/webtorrent/${t}/${n.path.split(/[/\\]/).map(encodeURIComponent).join("/")}`;
	}
	async startStream(e) {
		let { client: t, port: n } = await this.ensureStarted(), r = await this.addTorrent(t, e.torrentId), i = this.pickFile(r, e);
		if (!i) throw Error("This torrent contains no playable video file.");
		this.focusOn(r, i), this.selectedFile.set(r.infoHash, r.files.indexOf(i));
		let a = r.files.filter((e) => Ze.has(j(e.name))).map((e) => ({
			name: e.name,
			url: this.fileUrl(n, r.infoHash, e)
		}));
		return {
			infoHash: r.infoHash,
			streamUrl: this.fileUrl(n, r.infoHash, i),
			fileName: i.name,
			fileSize: i.length,
			files: this.describeFiles(r),
			subtitleUrls: a,
			mimeType: et(j(i.name))
		};
	}
	async addTorrent(e, t) {
		let n = this.extractInfoHash(t);
		if (n) {
			let t = await Promise.resolve(e.get(n));
			if (t && t.ready) return t;
		}
		return new Promise((n, r) => {
			let i = !1, a = setTimeout(() => {
				i || (i = !0, r(/* @__PURE__ */ Error("Timed out fetching torrent metadata. The swarm may be dead or unreachable — try a source with more seeders.")));
			}, $e), o = (e, t) => {
				i || (i = !0, clearTimeout(a), e ? r(e) : t && n(t));
			}, s;
			try {
				s = e.add(t, {
					path: this.downloadPath,
					strategy: "sequential",
					announce: [...Ge]
				}, (e) => o(null, e));
			} catch (e) {
				return o(e instanceof Error ? e : Error(String(e)));
			}
			s.on("error", (e) => {
				let t = e instanceof Error ? e.message : String(e);
				this.lastError.set(s.infoHash, t), o(Error(t));
			}), s.ready && o(null, s);
		});
	}
	extractInfoHash(e) {
		if (/^[a-f0-9]{40}$/i.test(e)) return e.toLowerCase();
		let t = e.match(/xt=urn:btih:([a-f0-9]{40})/i);
		return t ? t[1].toLowerCase() : null;
	}
	describeFiles(e) {
		let t = this.selectedFile.get(e.infoHash);
		return e.files.map((e, n) => ({
			index: n,
			name: e.name,
			path: e.path,
			length: e.length,
			isVideo: M(e),
			isSelected: n === t
		}));
	}
	computeReadyBytes(e, t) {
		let n = e.pieceLength;
		if (!n || !Array.isArray(e.pieces)) return Math.round(t.progress * t.length);
		let r = 0;
		for (let n of e.files) {
			if (n === t) break;
			r += n.length;
		}
		let i = Math.floor(r / n), a = Math.floor((r + t.length - 1) / n), o = 0;
		for (let t = i; t <= a && e.pieces[t] === null; t++) o += n;
		return Math.max(0, Math.min(t.length, o - r % n));
	}
	async getStats(e) {
		if (!this.client) return null;
		let t = await Promise.resolve(this.client.get(e));
		if (!t) return null;
		let n = this.selectedFile.get(e) ?? 0, r = t.files[n] ?? t.files[0];
		if (!r) return null;
		let i = this.computeReadyBytes(t, r);
		return {
			infoHash: e,
			name: t.name,
			streamUrl: this.fileUrl(this.serverPort, e, r),
			fileName: r.name,
			fileSize: r.length,
			downloaded: r.downloaded,
			progress: r.progress,
			downloadSpeed: t.downloadSpeed,
			uploadSpeed: t.uploadSpeed,
			peers: t.numPeers,
			seeds: t.numPeers,
			readyBytes: i,
			isPlayable: i >= Math.min(Qe, r.length * .02),
			timeRemainingMs: Number.isFinite(t.timeRemaining) ? t.timeRemaining : 0,
			isPaused: t.paused,
			error: this.lastError.get(e)
		};
	}
	async selectFile(e, t) {
		if (!this.client) return null;
		let n = await Promise.resolve(this.client.get(e));
		if (!n) return null;
		let r = n.files[t];
		return !r || !M(r) ? null : (this.focusOn(n, r), this.selectedFile.set(e, t), {
			infoHash: e,
			streamUrl: this.fileUrl(this.serverPort, e, r),
			fileName: r.name,
			fileSize: r.length,
			files: this.describeFiles(n),
			subtitleUrls: n.files.filter((e) => Ze.has(j(e.name))).map((t) => ({
				name: t.name,
				url: this.fileUrl(this.serverPort, e, t)
			})),
			mimeType: et(j(r.name))
		});
	}
	async pause(e) {
		(this.client ? await Promise.resolve(this.client.get(e)) : null)?.pause();
	}
	async resume(e) {
		(this.client ? await Promise.resolve(this.client.get(e)) : null)?.resume();
	}
	async stopStream(e, t = !1) {
		if (!this.client) return;
		let n = await Promise.resolve(this.client.get(e));
		n && (this.selectedFile.delete(e), this.lastError.delete(e), await new Promise((e) => {
			this.client?.remove(n, { destroyStore: !t }, () => e()), setTimeout(e, 5e3);
		}));
	}
	async getActiveStreams() {
		return this.client ? (await Promise.all(this.client.torrents.map((e) => this.getStats(e.infoHash)))).filter((e) => e !== null) : [];
	}
	getCachePath() {
		return this.downloadPath;
	}
	async clearCache() {
		let e = new Set(this.client?.torrents.map((e) => e.name) ?? []), t = 0;
		if (!l.existsSync(this.downloadPath)) return 0;
		for (let n of l.readdirSync(this.downloadPath)) if (!e.has(n)) try {
			l.rmSync(s.join(this.downloadPath, n), {
				recursive: !0,
				force: !0
			}), t++;
		} catch {}
		return t;
	}
	async destroy() {
		let e = this.client, t = this.server;
		this.client = null, this.server = null, this.serverPort = 0, this.selectedFile.clear(), await new Promise((e) => {
			if (!t) return e();
			t.close(() => e()), setTimeout(e, 3e3);
		}), await new Promise((t) => {
			if (!e || e.destroyed) return t();
			e.destroy(() => t()), setTimeout(t, 5e3);
		});
	}
}, N = {
	Movie: "Movie",
	TvSeries: "TvSeries",
	Anime: "Anime",
	AnimeMovie: "AnimeMovie",
	OVA: "OVA",
	Documentary: "Documentary",
	Live: "Live",
	NSFW: "NSFW",
	AsianDrama: "AsianDrama",
	Torrent: "Torrent"
}, P = "Catalogue";
function F(e) {
	return e ? e.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&quot;/g, "\"").replace(/&amp;/g, "&").replace(/&#039;|&apos;/g, "'").replace(/&nbsp;/g, " ").trim() : "";
}
function I(e, t) {
	return `cs3meta://${e}/${t}`;
}
function nt(e) {
	let t = e.match(/^cs3meta:\/\/(tvmaze|anilist)\/(.+)$/);
	return t ? {
		source: t[1],
		id: t[2]
	} : null;
}
function rt(e) {
	return (e.genres ?? []).includes("Anime") ? N.Anime : e.type === "Documentary" ? N.Documentary : N.TvSeries;
}
var it = class {
	async search(e, t) {
		let [n, r] = await Promise.allSettled([this.searchTvMaze(e, t), this.searchAniList(e, t)]), i = [];
		return n.status === "fulfilled" && i.push(...n.value), r.status === "fulfilled" && i.push(...r.value), i;
	}
	async searchTvMaze(e, t) {
		let n = await _(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(e)}`, { signal: t });
		return Array.isArray(n) ? n.map(({ show: e }) => e).filter((e) => !!(e?.id && e.name)).map((e) => ({
			name: e.name,
			url: I("tvmaze", e.id),
			apiName: P,
			type: rt(e),
			posterUrl: e.image?.original || e.image?.medium,
			year: e.premiered ? parseInt(e.premiered.slice(0, 4), 10) : void 0,
			id: e.id
		})) : [];
	}
	async searchAniList(e, t) {
		let n = JSON.stringify({
			query: "\n        query ($search: String) {\n          Page(perPage: 15) {\n            media(search: $search, type: ANIME, sort: SEARCH_MATCH) {\n              id\n              title { romaji english }\n              coverImage { extraLarge large }\n              startDate { year }\n              format\n            }\n          }\n        }",
			variables: { search: e }
		}), r = await fetch("https://graphql.anilist.co", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json"
			},
			body: n,
			signal: t ?? AbortSignal.timeout(12e3)
		});
		if (!r.ok) throw Error(`AniList HTTP ${r.status}`);
		return ((await r.json()).data?.Page?.media ?? []).filter((e) => !!e?.id).map((t) => ({
			name: t.title?.english || t.title?.romaji || e,
			url: I("anilist", t.id),
			apiName: P,
			type: t.format === "MOVIE" ? N.AnimeMovie : N.Anime,
			posterUrl: t.coverImage?.extraLarge || t.coverImage?.large,
			year: t.startDate?.year,
			id: t.id
		}));
	}
	async load(e, t) {
		let n = nt(e);
		return n ? n.source === "tvmaze" ? this.loadTvMaze(n.id, t) : this.loadAniList(n.id, t) : null;
	}
	async loadTvMaze(e, t) {
		let n = await _(`https://api.tvmaze.com/shows/${encodeURIComponent(e)}?embed=episodes`, { signal: t });
		if (!n?.name) return null;
		let r = (n._embedded?.episodes ?? []).filter((e) => e.number !== void 0 && e.number !== null).map((t) => ({
			name: t.name ? `S${t.season}E${t.number} · ${t.name}` : `Episode ${t.number}`,
			url: `${I("tvmaze", e)}?s=${t.season ?? 1}&e=${t.number}`,
			episode: t.number ?? void 0,
			season: t.season ?? void 0,
			posterUrl: t.image?.original || t.image?.medium,
			description: F(t.summary),
			date: t.airdate
		}));
		return {
			name: n.name,
			url: I("tvmaze", e),
			apiName: P,
			type: rt(n),
			posterUrl: n.image?.original || n.image?.medium,
			year: n.premiered ? parseInt(n.premiered.slice(0, 4), 10) : void 0,
			plot: F(n.summary),
			rating: n.rating?.average ?? void 0,
			tags: n.genres ?? [],
			duration: n.averageRuntime ? `${n.averageRuntime} min` : void 0,
			runtimeMinutes: n.averageRuntime ?? n.runtime ?? void 0,
			imdbId: n.externals?.imdb ?? void 0,
			episodes: r,
			id: n.id
		};
	}
	async loadAniList(e, t) {
		let n = JSON.stringify({
			query: "\n        query ($id: Int) {\n          Media(id: $id, type: ANIME) {\n            id idMal\n            title { romaji english native }\n            coverImage { extraLarge large }\n            bannerImage\n            startDate { year }\n            episodes duration format genres averageScore description status\n          }\n        }",
			variables: { id: parseInt(e, 10) }
		}), r = await fetch("https://graphql.anilist.co", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json"
			},
			body: n,
			signal: t ?? AbortSignal.timeout(12e3)
		});
		if (!r.ok) throw Error(`AniList HTTP ${r.status}`);
		let i = (await r.json()).data?.Media;
		if (!i?.id) return null;
		let a = i.title?.english || i.title?.romaji || "Unknown", o = i.format === "MOVIE", s = i.episodes ?? 0, c = o ? [] : Array.from({ length: s }, (e, t) => ({
			name: `Episode ${t + 1}`,
			url: `${I("anilist", i.id)}?e=${t + 1}`,
			episode: t + 1,
			season: 1
		}));
		return {
			name: a,
			url: I("anilist", i.id),
			apiName: P,
			type: o ? N.AnimeMovie : N.Anime,
			posterUrl: i.coverImage?.extraLarge || i.coverImage?.large,
			year: i.startDate?.year,
			plot: F(i.description),
			rating: i.averageScore ? i.averageScore / 10 : void 0,
			tags: i.genres ?? [],
			duration: i.duration ? `${i.duration} min` : void 0,
			runtimeMinutes: i.duration ?? void 0,
			episodes: c,
			id: i.id
		};
	}
	async resolveImdbId(e, t) {
		try {
			let n = await v(`https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(e)}&embed=nextepisode`, {
				timeoutMs: 8e3,
				retries: 0
			}), r = JSON.parse(n), i = r.externals?.imdb;
			if (!i) return;
			if (t && r.premiered) {
				let e = parseInt(r.premiered.slice(0, 4), 10);
				if (Math.abs(e - t) > 2) return;
			}
			return i;
		} catch {
			return;
		}
	}
}, L = "https://v3-cinemeta.strem.io";
function at(e, t) {
	return `cs3meta://cinemeta/${e}/${t}`;
}
function ot(e) {
	let t = e.match(/^cs3meta:\/\/cinemeta\/(movie|series)\/(tt\d+)/);
	return t ? {
		type: t[1],
		imdbId: t[2]
	} : null;
}
function st(e) {
	let t = e?.match(/(\d{4})/);
	return t ? parseInt(t[1], 10) : void 0;
}
function ct(e) {
	if (!e) return;
	let t = e.match(/(\d+)\s*h/i), n = e.match(/(\d+)\s*min/i);
	if (!(!t && !n)) return (t ? parseInt(t[1], 10) * 60 : 0) + (n ? parseInt(n[1], 10) : 0);
}
function lt(e, t) {
	let n = (t ?? []).some((e) => /animation|anime/i.test(e));
	return e === "series" ? n ? N.Anime : N.TvSeries : n ? N.AnimeMovie : N.Movie;
}
function ut(e, t) {
	let n = E(t), r = e.map((e) => {
		let r = E(e.name), i = Ue(t, e.name) * 100;
		r === n ? i += 60 : r.startsWith(n) && (i += 25);
		let a = r.split(" ").length - n.split(" ").length;
		return a > 0 && (i -= Math.min(20, a * 5)), {
			result: e,
			score: i
		};
	});
	return r.sort((e, t) => t.score - e.score), r.map((e) => e.result);
}
var dt = class {
	async search(e, t) {
		let n = encodeURIComponent(e), [r, i] = await Promise.allSettled([_(`${L}/catalog/movie/top/search=${n}.json`, {
			signal: t,
			timeoutMs: 15e3
		}), _(`${L}/catalog/series/top/search=${n}.json`, {
			signal: t,
			timeoutMs: 15e3
		})]), a = [], o = (e, t) => {
			if (e.status === "fulfilled") for (let n of e.value.metas ?? []) {
				let e = n.imdb_id || n.id;
				!e?.startsWith("tt") || !n.name || a.push({
					name: n.name,
					url: at(t, e),
					apiName: "Catalogue",
					type: lt(t, n.genres),
					posterUrl: n.poster,
					year: st(n.releaseInfo)
				});
			}
		};
		return o(r, "movie"), o(i, "series"), ut(a, e);
	}
	async load(e, t, n) {
		let r = (await _(`${L}/meta/${e}/${t}.json`, {
			signal: n,
			timeoutMs: 15e3
		})).meta;
		if (!r?.name) return null;
		let i = (r.videos ?? []).filter((e) => (e.season ?? 0) > 0).map((n) => {
			let r = n.season ?? 1, i = n.episode ?? n.number ?? 0;
			return {
				name: n.name || n.title ? `S${r}E${i} · ${n.name ?? n.title}` : `Episode ${i}`,
				url: `${at(e, t)}?s=${r}&e=${i}`,
				episode: i,
				season: r,
				posterUrl: n.thumbnail,
				description: n.overview ?? n.description,
				date: (n.firstAired ?? n.released)?.slice(0, 10),
				rating: n.rating ? parseFloat(n.rating) : void 0
			};
		}).sort((e, t) => (e.season ?? 0) - (t.season ?? 0) || (e.episode ?? 0) - (t.episode ?? 0));
		return {
			name: r.name,
			imdbId: t,
			type: lt(e, r.genres),
			posterUrl: r.poster,
			backgroundUrl: r.background,
			year: st(r.releaseInfo),
			plot: r.description,
			rating: r.imdbRating ? parseFloat(r.imdbRating) : void 0,
			tags: r.genres,
			actors: r.cast,
			duration: r.runtime,
			runtimeMinutes: ct(r.runtime),
			episodes: i
		};
	}
};
//#endregion
//#region electron/torrent/indexers/builtins.ts
async function R(e, t) {
	let n = /* @__PURE__ */ Error("No mirrors configured");
	for (let r of e) try {
		return await t(r);
	} catch (e) {
		n = e;
	}
	throw n;
}
var ft = new re({
	ignoreAttributes: !1,
	attributeNamePrefix: "@_",
	parseTagValue: !1,
	trimValues: !0
});
function pt(e) {
	return e == null ? [] : Array.isArray(e) ? e : [e];
}
var mt = class e {
	id = "yts";
	name = "YTS";
	specialises = "movie";
	static MIRRORS = [
		"https://yts.mx",
		"https://yts.rs",
		"https://yts.lt",
		"https://yts.am"
	];
	canHandle(e) {
		return e.season === void 0 && e.episode === void 0;
	}
	async search(t, n) {
		let r = Math.min(t.limit ?? 30, 50);
		return R(e.MIRRORS, async (e) => {
			let i = (await _(`${e}/api/v2/list_movies.json?query_term=${encodeURIComponent(t.query)}&limit=${r}&sort_by=seeds&order_by=desc`, { signal: n })).data?.movies ?? [], a = [];
			for (let e of i) {
				let t = e.title_long || e.title;
				if (t) for (let n of e.torrents ?? []) {
					if (!n.hash) continue;
					let e = [
						t,
						n.quality,
						n.type?.toUpperCase(),
						n.video_codec,
						"YTS"
					].filter(Boolean).join(" ");
					a.push({
						title: e,
						infoHash: n.hash.toLowerCase(),
						magnet: O(n.hash, e),
						sizeBytes: n.size_bytes ?? 0,
						seeders: n.seeds ?? 0,
						leechers: n.peers ?? 0,
						publishedAt: n.date_uploaded_unix ? n.date_uploaded_unix * 1e3 : void 0,
						category: "Movies"
					});
				}
			}
			return a;
		});
	}
}, ht = class e {
	id = "eztv";
	name = "EZTV";
	specialises = "tv";
	static MIRRORS = [
		"https://eztvx.to",
		"https://eztv.re",
		"https://eztv.wf",
		"https://eztv.tf"
	];
	canHandle(e) {
		return !!e.imdbId;
	}
	async search(t, n) {
		let r = (t.imdbId ?? "").replace(/^tt/i, "");
		if (!r) return [];
		let i = Math.min(t.limit ?? 50, 100);
		return R(e.MIRRORS, async (e) => ((await _(`${e}/api/get-torrents?imdb_id=${encodeURIComponent(r)}&limit=${i}`, { signal: n })).torrents ?? []).filter((e) => e.title && (e.hash || e.magnet_url)).map((e) => ({
			title: e.title,
			infoHash: e.hash?.toLowerCase(),
			magnet: e.magnet_url,
			torrentUrl: e.torrent_url,
			sizeBytes: k(e.size_bytes),
			seeders: A(e.seeds),
			leechers: A(e.peers),
			publishedAt: e.date_released_unix ? e.date_released_unix * 1e3 : void 0,
			category: "TV"
		})));
	}
}, gt = class e {
	id = "nyaa";
	name = "Nyaa";
	specialises = "anime";
	static MIRRORS = ["https://nyaa.si", "https://nyaa.iss.one"];
	canHandle() {
		return !0;
	}
	async search(t, n) {
		let r = [t.query];
		t.episode !== void 0 && r.push(String(t.episode).padStart(2, "0"));
		let i = encodeURIComponent(r.join(" "));
		return R(e.MIRRORS, async (e) => {
			let t = await v(`${e}/?page=rss&q=${i}&c=1_2&f=0`, { signal: n });
			return pt(ft.parse(t)?.rss?.channel?.item).map((e) => {
				let t = String(e.title ?? "").trim(), n = String(e["nyaa:infoHash"] ?? "").toLowerCase();
				if (!t || !/^[a-f0-9]{40}$/.test(n)) return null;
				let r = String(e.pubDate ?? ""), i = r ? Date.parse(r) : NaN;
				return {
					title: t,
					infoHash: n,
					magnet: O(n, t),
					torrentUrl: typeof e.link == "string" ? e.link : void 0,
					sizeBytes: k(String(e["nyaa:size"] ?? "")),
					seeders: A(e["nyaa:seeders"]),
					leechers: A(e["nyaa:leechers"]),
					publishedAt: Number.isNaN(i) ? void 0 : i,
					category: String(e["nyaa:category"] ?? "Anime")
				};
			}).filter((e) => e !== null);
		});
	}
};
//#endregion
//#region electron/torrent/indexers/aggregators.ts
function _t(e) {
	let t = e.split("\n").map((e) => e.trim()).filter(Boolean), n = t.find((e) => /👤|💾|⚙️/.test(e)) ?? "", r = t.filter((e) => e !== n), i = A(n.match(/👤\s*([\d,]+)/)?.[1]?.replace(/,/g, "")), a = k(n.match(/💾\s*([\d.,]+\s*[KMGT]i?B)/i)?.[1]), o = n.match(/⚙️\s*(.+?)\s*$/)?.[1];
	return {
		releaseName: r[0] ?? e,
		fileName: r.length > 1 ? r[r.length - 1] : void 0,
		seeders: i,
		sizeBytes: a,
		source: o
	};
}
var vt = class e {
	id = "torrentio";
	name = "Torrentio";
	specialises = "any";
	static MIRRORS = ["https://torrentio.strem.fun", "https://torrentio.deno.dev"];
	canHandle(e) {
		return !!e.imdbId;
	}
	async search(t, n) {
		let r = t.imdbId?.startsWith("tt") ? t.imdbId : `tt${t.imdbId}`, i = t.season !== void 0 && t.episode !== void 0 ? `series/${r}:${t.season}:${t.episode}` : `movie/${r}`, a = /* @__PURE__ */ Error("No Torrentio mirror responded");
		for (let t of e.MIRRORS) try {
			return ((await _(`${t}/stream/${i}.json`, {
				signal: n,
				timeoutMs: 25e3
			})).streams ?? []).filter((e) => !!e?.infoHash).map((e) => {
				let t = _t(e.title ?? e.name ?? ""), n = e.behaviorHints?.filename ?? t.fileName, r = e.infoHash.toLowerCase();
				return {
					title: t.releaseName,
					infoHash: r,
					magnet: O(r, t.releaseName),
					sizeBytes: t.sizeBytes,
					seeders: t.seeders,
					leechers: 0,
					fileIndex: e.fileIdx,
					expectedFileName: n,
					category: t.source
				};
			});
		} catch (e) {
			a = e;
		}
		throw a;
	}
}, yt = class e {
	id = "apibay";
	name = "The Pirate Bay";
	specialises = "any";
	static MIRRORS = ["https://apibay.org"];
	canHandle(e) {
		return !!e.query;
	}
	async search(t, n) {
		let r = [t.query];
		t.season !== void 0 && t.episode !== void 0 ? r.push(`S${String(t.season).padStart(2, "0")}E${String(t.episode).padStart(2, "0")}`) : t.season !== void 0 && r.push(`S${String(t.season).padStart(2, "0")}`);
		let i = /* @__PURE__ */ Error("No apibay mirror responded");
		for (let t of e.MIRRORS) try {
			let e = await _(`${t}/q.php?q=${encodeURIComponent(r.join(" "))}`, {
				signal: n,
				timeoutMs: 2e4
			});
			return Array.isArray(e) ? e.filter((e) => e?.name && e.info_hash && e.info_hash !== "0000000000000000000000000000000000000000").map((e) => {
				let t = e.info_hash.toLowerCase(), n = e.name;
				return {
					title: n,
					infoHash: t,
					magnet: O(t, n),
					sizeBytes: k(e.size),
					seeders: A(e.seeders),
					leechers: A(e.leechers),
					publishedAt: e.added ? A(e.added) * 1e3 : void 0,
					category: e.category
				};
			}) : [];
		} catch (e) {
			i = e;
		}
		throw i;
	}
}, bt = new re({
	ignoreAttributes: !1,
	attributeNamePrefix: "@_",
	parseTagValue: !1,
	trimValues: !0,
	isArray: (e) => e === "item" || e === "torznab:attr"
});
function xt(e) {
	let t = {};
	for (let n of e["torznab:attr"] ?? []) {
		let e = n["@_name"], r = n["@_value"];
		e && r !== void 0 && (t[e.toLowerCase()] = r);
	}
	return t;
}
var St = class {
	id;
	name;
	specialises = "any";
	baseUrl;
	apiKey;
	slug;
	constructor(e) {
		this.id = e.id, this.name = e.name, this.baseUrl = (e.baseUrl ?? "").replace(/\/+$/, ""), this.apiKey = e.apiKey ?? "", this.slug = e.indexerSlug || "all";
	}
	canHandle() {
		return !!this.baseUrl;
	}
	candidateEndpoints() {
		return [
			`${this.baseUrl}/api/v2.0/indexers/${this.slug}/results/torznab/api`,
			`${this.baseUrl}/api/v1/indexer/${this.slug}/newznab`,
			`${this.baseUrl}/api`
		];
	}
	buildQuery(e) {
		let t = new URLSearchParams(), n = e.season !== void 0 || e.episode !== void 0;
		return t.set("t", n ? "tvsearch" : e.imdbId ? "movie" : "search"), this.apiKey && t.set("apikey", this.apiKey), e.query && t.set("q", e.query), e.season !== void 0 && t.set("season", String(e.season)), e.episode !== void 0 && t.set("ep", String(e.episode)), e.imdbId && t.set("imdbid", e.imdbId.replace(/^tt/i, "")), t.set("limit", String(Math.min(e.limit ?? 100, 200))), t.toString();
	}
	async search(e, t) {
		let n = this.buildQuery(e), r = /* @__PURE__ */ Error("No Torznab endpoint responded");
		for (let e of this.candidateEndpoints()) try {
			let r = await v(`${e}?${n}`, {
				signal: t,
				timeoutMs: 2e4
			});
			if (/<error\b/i.test(r)) {
				let e = r.match(/code="(\d+)"/)?.[1], t = r.match(/description="([^"]*)"/)?.[1];
				throw Error(`Torznab error ${e ?? "?"}: ${t ?? "unknown"}`);
			}
			return this.parseResponse(r);
		} catch (e) {
			r = e;
		}
		throw r;
	}
	parseResponse(e) {
		return (bt.parse(e)?.rss?.channel?.item ?? []).map((e) => {
			let t = String(e.title ?? "").trim();
			if (!t) return null;
			let n = xt(e), r = n.magneturl || (e.link?.startsWith("magnet:") ? e.link : void 0), i = e.enclosure?.["@_url"], a = n.downloadurl || (i && !i.startsWith("magnet:") ? i : void 0) || (e.link && !e.link.startsWith("magnet:") ? e.link : void 0), o = n.infohash?.toLowerCase();
			if (!r && !o && !a) return null;
			let s = k(e.size) || k(n.size) || k(e.enclosure?.["@_length"]), c = e.pubDate ? Date.parse(e.pubDate) : NaN;
			return {
				title: t,
				infoHash: o && /^[a-f0-9]{40}$/.test(o) ? o : void 0,
				magnet: r,
				torrentUrl: a,
				sizeBytes: s,
				seeders: A(n.seeders),
				leechers: Math.max(0, A(n.peers) - A(n.seeders)),
				publishedAt: Number.isNaN(c) ? void 0 : c,
				category: Array.isArray(e.category) ? e.category[0] : e.category
			};
		}).filter((e) => e !== null);
	}
	async testConnection(e) {
		if (!this.baseUrl) return {
			ok: !1,
			message: "No base URL configured"
		};
		let t = new URLSearchParams({ t: "caps" });
		this.apiKey && t.set("apikey", this.apiKey);
		for (let n of this.candidateEndpoints()) try {
			let r = await v(`${n}?${t}`, {
				signal: e,
				timeoutMs: 1e4,
				retries: 0
			});
			if (/<error\b/i.test(r)) return {
				ok: !1,
				message: r.match(/description="([^"]*)"/)?.[1] ?? "Torznab returned an error"
			};
			if (/<caps\b/i.test(r)) return {
				ok: !0,
				message: `Connected to ${n.replace(this.baseUrl, "")}`
			};
		} catch {}
		return {
			ok: !1,
			message: "No Torznab endpoint responded. Check URL and API key."
		};
	}
}, Ct = {
	[b.Remux]: 100,
	[b.BluRay]: 90,
	[b.WebDL]: 85,
	[b.WebRip]: 70,
	[b.HDTV]: 55,
	[b.DVDRip]: 40,
	[b.SCR]: 10,
	[b.TS]: 5,
	[b.CAM]: 0,
	[b.Unknown]: 50
}, wt = [
	b.CAM,
	b.TS,
	b.SCR
], Tt = {
	[y.UHD_4K]: {
		min: 6e7,
		ideal: 35e7
	},
	[y.QHD]: {
		min: 35e6,
		ideal: 18e7
	},
	[y.FHD]: {
		min: 18e6,
		ideal: 9e7
	},
	[y.HD]: {
		min: 8e6,
		ideal: 45e6
	},
	[y.SD]: {
		min: 3e6,
		ideal: 2e7
	},
	[y.LD]: {
		min: 1e6,
		ideal: 1e7
	},
	[y.Unknown]: {
		min: 0,
		ideal: 0
	}
};
function Et(e) {
	let t = Math.min(300, Math.round(Math.log2(e.seeders + 1) * 42));
	return {
		points: t,
		reason: `${e.seeders} seeders (+${t})`
	};
}
function Dt(e, t) {
	let n = e.parsed.resolution;
	if (n === y.Unknown) return {
		points: -10,
		reason: "Unknown resolution (-10)"
	};
	if (n === t.preferredResolution) return {
		points: 120,
		reason: `Preferred resolution ${n}p (+120)`
	};
	let r = Object.values(y).filter((e) => e > 0).sort((e, t) => t - e), i = r.indexOf(t.preferredResolution), a = r.indexOf(n), o = Math.abs(i - a), s = a < i ? o * 20 : o * 40, c = Math.max(-120, 120 - s);
	return {
		points: c,
		reason: `${n}p vs preferred ${t.preferredResolution}p (${c >= 0 ? "+" : ""}${c})`
	};
}
function Ot(e) {
	let t = Ct[e.parsed.source] ?? 50;
	return {
		points: t,
		reason: `Source ${e.parsed.source} (+${t})`
	};
}
function kt(e, t) {
	let n = e.parsed.videoCodec;
	return t.preferH264 ? n === x.H264 ? {
		points: 60,
		reason: "H.264 — broadest compatibility (+60)"
	} : n === x.H265 ? {
		points: -70,
		reason: "HEVC — may not decode (-70)"
	} : n === x.AV1 ? {
		points: -50,
		reason: "AV1 — may not decode (-50)"
	} : {
		points: 0,
		reason: ""
	} : n === x.H265 ? {
		points: 25,
		reason: "HEVC — efficient (+25)"
	} : n === x.AV1 ? {
		points: 15,
		reason: "AV1 — efficient (+15)"
	} : n === x.H264 ? {
		points: 20,
		reason: "H.264 — compatible (+20)"
	} : n === x.XviD ? {
		points: -40,
		reason: "XviD — legacy (-40)"
	} : {
		points: 0,
		reason: ""
	};
}
function At(e, t) {
	let n = Tt[e.parsed.resolution];
	if (!n || n.ideal === 0 || e.sizeBytes === 0 || t <= 0) return {
		points: 0,
		reason: ""
	};
	let r = e.sizeBytes / t;
	return r < n.min ? {
		points: -90,
		reason: "Suspiciously small for its claimed resolution (-90)"
	} : r > n.ideal * 3 ? {
		points: -25,
		reason: "Very large — heavy for streaming (-25)"
	} : r >= n.min * 1.5 && r <= n.ideal * 1.5 ? {
		points: 30,
		reason: "Bitrate in the expected band (+30)"
	} : {
		points: 0,
		reason: ""
	};
}
function jt(e, t) {
	if (t.preferredLanguages.length === 0) return {
		points: 0,
		reason: ""
	};
	let n = e.parsed.languages;
	if (n.length === 0) return t.preferredLanguages.includes("en") ? {
		points: 15,
		reason: "Untagged — likely English (+15)"
	} : {
		points: 0,
		reason: ""
	};
	let r = n.find((e) => t.preferredLanguages.includes(e));
	return r ? {
		points: 55,
		reason: `Preferred language ${r} (+55)`
	} : e.parsed.isMultiAudio ? {
		points: 20,
		reason: "Multi-audio (+20)"
	} : {
		points: -35,
		reason: `Only ${n.join(", ")} (-35)`
	};
}
function Mt(e, t) {
	let n = [], r = e.parsed;
	(r.isRepack || r.isProper) && n.push({
		points: 25,
		reason: "REPACK/PROPER (+25)"
	}), r.isRemastered && n.push({
		points: 15,
		reason: "Remastered (+15)"
	}), r.hasHardcodedSubs && n.push({
		points: -30,
		reason: "Hardcoded subtitles (-30)"
	}), r.is3D && n.push({
		points: -60,
		reason: "3D — not playable flat (-60)"
	}), r.isDualAudio && n.push({
		points: 20,
		reason: "Dual audio (+20)"
	}), t.preferHDR && r.hdr.length > 0 ? n.push({
		points: 45,
		reason: `HDR: ${r.hdr.join(", ")} (+45)`
	}) : !t.preferHDR && r.hdr.includes("DV") && !r.hdr.includes("HDR10") && n.push({
		points: -25,
		reason: "Dolby Vision only — may look washed out on SDR (-25)"
	});
	let i = r.releaseGroup?.toLowerCase();
	return i && t.preferredGroups.some((e) => e.toLowerCase() === i) && n.push({
		points: 70,
		reason: `Preferred group ${r.releaseGroup} (+70)`
	}), r.isSeasonPack && n.push({
		points: 10,
		reason: "Season pack (+10)"
	}), n;
}
function Nt(e, t) {
	let n = t.preferences, r = e.parsed;
	if (e.seeders < n.minSeeders) return `Below minimum seeders (${e.seeders} < ${n.minSeeders})`;
	if (n.excludeLowQualitySources && wt.includes(r.source)) return `Low-quality source (${r.source})`;
	if (n.minResolution > 0 && r.resolution > 0 && r.resolution < n.minResolution) return `Below minimum resolution (${r.resolution}p < ${n.minResolution}p)`;
	if (n.maxSizeBytes && e.sizeBytes > n.maxSizeBytes) return "Exceeds maximum size";
	let i = e.title.toLowerCase(), a = n.blockedKeywords.find((e) => e && i.includes(e.toLowerCase()));
	if (a) return `Blocked keyword "${a}"`;
	let o = r.releaseGroup?.toLowerCase();
	return o && n.blockedGroups.some((e) => e.toLowerCase() === o) ? `Blocked group ${r.releaseGroup}` : We(r, t.season, t.episode) ? t.expectedTitle && Ue(t.expectedTitle, r.cleanTitle || e.title) < .45 ? "Title does not match the selected item" : null : "Does not match the requested season/episode";
}
function Pt(e, t) {
	let n = [], r = [], i = t.runtimeMinutes ?? (t.episode === void 0 ? 110 : 45);
	for (let a of e) {
		let e = Nt(a, t);
		if (e) {
			r.push({
				result: a,
				reason: e
			});
			continue;
		}
		let o = [
			Et(a),
			Dt(a, t.preferences),
			Ot(a),
			kt(a, t.preferences),
			At(a, i),
			jt(a, t.preferences),
			...Mt(a, t.preferences)
		];
		t.expectedYear && a.parsed.year && o.push(a.parsed.year === t.expectedYear ? {
			points: 40,
			reason: `Year ${t.expectedYear} matches (+40)`
		} : {
			points: -50,
			reason: `Year ${a.parsed.year} ≠ ${t.expectedYear} (-50)`
		}), a.score = o.reduce((e, t) => e + t.points, 0), a.scoreReasons = o.filter((e) => e.reason).map((e) => e.reason), n.push(a);
	}
	return n.sort((e, t) => t.score - e.score || t.seeders - e.seeders), {
		accepted: n,
		rejected: r
	};
}
function Ft(e) {
	let t = /* @__PURE__ */ new Map(), n = [];
	for (let r of e) {
		if (!r.infoHash) {
			n.push(r);
			continue;
		}
		let e = t.get(r.infoHash);
		if (!e) {
			t.set(r.infoHash, r);
			continue;
		}
		e.seeders = Math.max(e.seeders, r.seeders), e.leechers = Math.max(e.leechers, r.leechers), !e.sizeBytes && r.sizeBytes && (e.sizeBytes = r.sizeBytes), !e.torrentUrl && r.torrentUrl && (e.torrentUrl = r.torrentUrl), e.indexerName.includes(r.indexerName) || (e.indexerName = `${e.indexerName}, ${r.indexerName}`);
	}
	return [...t.values(), ...n];
}
//#endregion
//#region electron/torrent/indexerRegistry.ts
var It = 3, Lt = 3e5, Rt = 2e4, z = "torrent_indexer_configs", zt = "torrent_indexer_configs_version", Bt = "torrent_source_preferences", Vt = [
	{
		id: "torrentio",
		name: "Torrentio",
		kind: S.Builtin,
		enabled: !0
	},
	{
		id: "apibay",
		name: "The Pirate Bay",
		kind: S.Builtin,
		enabled: !0
	},
	{
		id: "yts",
		name: "YTS",
		kind: S.Builtin,
		enabled: !1,
		supportedTypes: [N.Movie]
	},
	{
		id: "eztv",
		name: "EZTV",
		kind: S.Builtin,
		enabled: !1,
		supportedTypes: [N.TvSeries]
	},
	{
		id: "nyaa",
		name: "Nyaa",
		kind: S.Builtin,
		enabled: !1,
		supportedTypes: [
			N.Anime,
			N.AnimeMovie,
			N.OVA
		]
	}
], Ht = 2, Ut = class {
	configs = [];
	circuits = /* @__PURE__ */ new Map();
	datastore;
	constructor(e) {
		this.datastore = e;
		let t = this.datastore.getInt(zt, 0), n = this.datastore.getObject(z, null);
		if (t < Ht || !Array.isArray(n) || n.length === 0) {
			let e = Array.isArray(n) ? n.filter((e) => e.kind === S.Torznab) : [];
			this.configs = [...Vt, ...e], this.datastore.setObject(z, this.configs), this.datastore.setInt(zt, Ht);
		} else this.configs = n;
	}
	getConfigs() {
		return [...this.configs];
	}
	saveConfigs(e) {
		this.configs = e, this.datastore.setObject(z, e);
		for (let t of e) this.circuits.delete(t.id);
	}
	upsertConfig(e) {
		let t = this.configs.filter((t) => t.id !== e.id);
		t.push(e), this.saveConfigs(t);
	}
	removeConfig(e) {
		this.saveConfigs(this.configs.filter((t) => t.id !== e));
	}
	getPreferences() {
		let e = this.datastore.getObject(Bt, {});
		return {
			...Oe,
			...e ?? {}
		};
	}
	savePreferences(e) {
		let t = {
			...this.getPreferences(),
			...e
		};
		return this.datastore.setObject(Bt, t), t;
	}
	buildAdapter(e) {
		if (e.kind === S.Torznab) return new St(e);
		switch (e.id) {
			case "torrentio": return new vt();
			case "apibay": return new yt();
			case "yts": return new mt();
			case "eztv": return new ht();
			case "nyaa": return new gt();
			default: return null;
		}
	}
	async testIndexer(e) {
		let t = this.buildAdapter(e);
		if (!t) return {
			ok: !1,
			message: `Unknown indexer "${e.id}"`
		};
		if (t instanceof St) return t.testConnection();
		let n = Date.now();
		try {
			return {
				ok: !0,
				message: `OK — ${(await t.search({
					query: "the",
					limit: 5
				}, AbortSignal.timeout(Rt))).length} results in ${Date.now() - n} ms`
			};
		} catch (e) {
			return {
				ok: !1,
				message: B(e)
			};
		}
	}
	circuitFor(e) {
		let t = this.circuits.get(e);
		return t || (t = { consecutiveFailures: 0 }, this.circuits.set(e, t)), t;
	}
	isCircuitOpen(e) {
		let t = this.circuitFor(e);
		return t.consecutiveFailures < It || !t.openedAt ? !1 : Date.now() - t.openedAt > Lt ? (t.consecutiveFailures = 2, t.openedAt = void 0, !1) : !0;
	}
	recordSuccess(e, t, n) {
		let r = this.circuitFor(e);
		r.consecutiveFailures = 0, r.openedAt = void 0, r.lastOk = Date.now(), r.lastError = void 0, r.lastLatencyMs = t, r.lastResultCount = n;
	}
	recordFailure(e, t, n) {
		let r = this.circuitFor(e);
		r.consecutiveFailures += 1, r.lastError = B(t), r.lastLatencyMs = n, r.consecutiveFailures >= It && !r.openedAt && (r.openedAt = Date.now());
	}
	getHealth() {
		return this.configs.map((e) => {
			let t = this.circuitFor(e.id);
			return {
				id: e.id,
				name: e.name,
				enabled: e.enabled,
				lastOk: t.lastOk,
				lastError: t.lastError,
				lastLatencyMs: t.lastLatencyMs,
				lastResultCount: t.lastResultCount,
				consecutiveFailures: t.consecutiveFailures,
				isCircuitOpen: this.isCircuitOpen(e.id)
			};
		});
	}
	isRelevant(e, t) {
		return !t.type || e.kind === S.Torznab || !e.supportedTypes || e.supportedTypes.length === 0 || e.supportedTypes.includes(t.type);
	}
	async search(e, t) {
		let n = t?.preferences ?? this.getPreferences(), r = [], i = this.configs.map(async (t) => {
			if (!t.enabled) return r.push({
				id: t.id,
				name: t.name,
				ok: !1,
				count: 0,
				latencyMs: 0,
				skipped: "Disabled"
			}), [];
			if (this.isCircuitOpen(t.id)) return r.push({
				id: t.id,
				name: t.name,
				ok: !1,
				count: 0,
				latencyMs: 0,
				skipped: "Temporarily disabled after repeated failures"
			}), [];
			if (!this.isRelevant(t, e)) return r.push({
				id: t.id,
				name: t.name,
				ok: !0,
				count: 0,
				latencyMs: 0,
				skipped: "Not applicable to this content type"
			}), [];
			let n = this.buildAdapter(t);
			if (!n || !n.canHandle(e)) return r.push({
				id: t.id,
				name: t.name,
				ok: !0,
				count: 0,
				latencyMs: 0,
				skipped: n ? "Cannot serve this query (missing IMDb id or unsupported)" : "No adapter"
			}), [];
			let i = Date.now();
			try {
				let a = await n.search(e, AbortSignal.timeout(Rt)), o = Date.now() - i, s = a.map((e) => Ye(e, t)).filter((e) => e !== null);
				return this.recordSuccess(t.id, o, s.length), r.push({
					id: t.id,
					name: t.name,
					ok: !0,
					count: s.length,
					latencyMs: o
				}), s;
			} catch (e) {
				let n = Date.now() - i;
				return this.recordFailure(t.id, e, n), r.push({
					id: t.id,
					name: t.name,
					ok: !1,
					count: 0,
					latencyMs: n,
					error: B(e)
				}), [];
			}
		}), { accepted: a, rejected: o } = Pt(Ft((await Promise.allSettled(i)).flatMap((e) => e.status === "fulfilled" ? e.value : [])), {
			expectedTitle: t?.expectedTitle,
			expectedYear: t?.expectedYear,
			season: t?.season ?? e.season,
			episode: t?.episode ?? e.episode,
			runtimeMinutes: t?.runtimeMinutes,
			preferences: n
		});
		return {
			results: a,
			rejected: o,
			indexerOutcomes: r
		};
	}
};
function B(e) {
	if (e instanceof Error) {
		if (e.name === "TimeoutError" || e.name === "AbortError") return "Timed out";
		let t = e.cause;
		return t?.code === "ENOTFOUND" ? "Host not found (DNS blocked or domain moved)" : t?.code === "ECONNREFUSED" ? "Connection refused" : t?.code === "ETIMEDOUT" ? "Connection timed out" : t?.code ? `${e.message} (${t.code})` : e.message;
	}
	return String(e);
}
//#endregion
//#region electron/contentService.ts
function Wt(e) {
	let t = e.includes("?") ? e.slice(e.indexOf("?") + 1) : "";
	if (!t) return {};
	let n = new URLSearchParams(t), r = n.get("s"), i = n.get("e");
	return {
		season: r ? parseInt(r, 10) : void 0,
		episode: i ? parseInt(i, 10) : void 0
	};
}
function Gt(e) {
	let t = e.indexOf("?");
	return t >= 0 ? e.slice(0, t) : e;
}
var Kt = class {
	cinemeta = new dt();
	metadata = new it();
	registry;
	engine;
	plugins;
	detailCache = /* @__PURE__ */ new Map();
	constructor(e, t, n) {
		this.registry = new Ut(e), this.plugins = t, this.engine = n;
	}
	getRegistry() {
		return this.registry;
	}
	getEngine() {
		return this.engine;
	}
	async search(e) {
		let t = e.trim();
		if (!t) return [];
		if (t.startsWith("magnet:")) {
			let e = D(t);
			return [{
				name: decodeURIComponent(t.match(/dn=([^&]+)/)?.[1] ?? "Magnet link"),
				url: t,
				apiName: "Magnet",
				type: N.Torrent,
				quality: e ? e.slice(0, 8) : void 0
			}];
		}
		let n = [], r = await this.plugins.searchAll(t);
		n.push(...r);
		let [i, a] = await Promise.allSettled([this.cinemeta.search(t), this.metadata.search(t)]);
		if (i.status === "fulfilled" && n.push(...i.value), a.status === "fulfilled") {
			let e = new Set(n.map((e) => `${e.name.toLowerCase()}|${e.year ?? ""}`));
			for (let t of a.value) {
				let r = `${t.name.toLowerCase()}|${t.year ?? ""}`;
				e.has(r) || (e.add(r), n.push(t));
			}
		}
		if (n.length === 0 && i.status === "rejected" && a.status === "rejected") throw i.reason instanceof Error ? i.reason : Error(String(i.reason));
		return n;
	}
	async load(e) {
		let t = Gt(e), n = this.detailCache.get(t);
		if (n) return n;
		let r = ot(t);
		if (r) {
			let e = await this.cinemeta.load(r.type, r.imdbId);
			if (!e) return null;
			let n = {
				name: e.name,
				url: t,
				apiName: "Catalogue",
				type: e.type,
				posterUrl: e.posterUrl,
				year: e.year,
				plot: e.plot,
				rating: e.rating,
				tags: e.tags,
				actors: e.actors,
				duration: e.duration,
				runtimeMinutes: e.runtimeMinutes,
				imdbId: e.imdbId,
				episodes: e.episodes
			};
			return this.detailCache.set(t, n), n;
		}
		if (nt(t)) {
			let e = await this.metadata.load(t);
			return e && (e.imdbId ||= await this.metadata.resolveImdbId(e.name, e.year), this.detailCache.set(t, e)), e;
		}
		return this.plugins.loadMedia(t);
	}
	async getSources(e) {
		let t = Wt(e.mediaUrl), n = e.season ?? t.season, r = e.episode ?? t.episode, i = Gt(e.mediaUrl);
		if (i.startsWith("magnet:")) {
			let e = D(i) ?? "", t = decodeURIComponent(i.match(/dn=([^&]+)/)?.[1] ?? "Magnet link");
			return {
				sources: [{
					infoHash: e,
					title: t,
					magnet: i,
					sizeBytes: 0,
					seeders: 0,
					leechers: 0,
					indexerId: "magnet",
					indexerName: "Direct magnet",
					parsed: T(t),
					score: 0,
					scoreReasons: ["Supplied directly by the user"]
				}],
				filtered: [],
				indexerOutcomes: [],
				query: {
					title: t,
					season: n,
					episode: r
				}
			};
		}
		let a = await this.load(i), o = e.titleOverride ?? a?.name;
		if (!o) return {
			sources: [],
			filtered: [],
			indexerOutcomes: [],
			emptyReason: "Could not determine a title to search for.",
			query: {
				title: "",
				season: n,
				episode: r
			}
		};
		let s = a?.type === N.Anime || a?.type === N.AnimeMovie, c = {
			query: a?.year && r === void 0 ? `${o} ${a.year}` : o,
			type: a?.type,
			season: n,
			episode: r,
			year: a?.year,
			imdbId: a?.imdbId,
			limit: 100
		}, l = await this.registry.search(c, {
			expectedTitle: o,
			expectedYear: s ? void 0 : a?.year,
			season: n,
			episode: r,
			runtimeMinutes: a?.runtimeMinutes
		}), u = {
			sources: l.results,
			filtered: l.rejected.slice(0, 50).map((e) => ({
				title: e.result.title,
				reason: e.reason,
				seeders: e.result.seeders
			})),
			indexerOutcomes: l.indexerOutcomes,
			query: {
				title: o,
				season: n,
				episode: r,
				imdbId: a?.imdbId
			}
		};
		return l.results.length === 0 && (u.emptyReason = this.explainEmptyResult(l)), u;
	}
	explainEmptyResult(e) {
		let t = e.indexerOutcomes.filter((e) => !e.skipped), n = t.filter((e) => !e.ok);
		if (t.length === 0) return "No indexers are enabled for this content type. Add a Jackett or Prowlarr indexer in Settings → Sources.";
		if (n.length === t.length) {
			let e = [...new Set(n.map((e) => e.error ?? "unknown error"))];
			return `All ${n.length} indexer(s) failed: ${e.join("; ")}. Public torrent sites are often DNS-blocked by ISPs — a local Jackett/Prowlarr instance is the reliable route.`;
		}
		return e.rejected.length > 0 ? `Found ${e.rejected.length} result(s), but all were filtered out by your source preferences. Loosen the filters in Settings → Sources, or view the filtered list.` : "No sources found for this title. Try a different episode, or add more indexers.";
	}
	async startStream(e, t, n) {
		let r = e.magnet || e.torrentUrl || e.infoHash;
		if (!r) throw Error("This source has no magnet link, torrent file, or infohash.");
		return this.engine.startStream({
			torrentId: r,
			season: t,
			episode: n,
			fileIndex: e.fileIndex,
			expectedFileName: e.expectedFileName
		});
	}
	getPreferences() {
		return this.registry.getPreferences();
	}
	savePreferences(e) {
		return this.registry.savePreferences(e);
	}
}, qt = "extension_update_settings", V = "extension_available_updates", Jt = 864e5, H = 3e4, Yt = class {
	datastore;
	plugins;
	timer = null;
	inFlight = null;
	notify = null;
	constructor(e, t) {
		this.datastore = e, this.plugins = t;
	}
	setNotifier(e) {
		this.notify = e;
	}
	emit(e, t) {
		try {
			this.notify?.(e, t);
		} catch {}
	}
	getSettings() {
		let e = this.datastore.getObject(qt, {});
		return {
			policy: e?.policy ?? "daily",
			autoInstall: e?.autoInstall ?? !1,
			lastCheckedAt: e?.lastCheckedAt ?? 0,
			lastResult: e?.lastResult
		};
	}
	saveSettings(e) {
		let t = {
			...this.getSettings(),
			...e
		};
		return this.datastore.setObject(qt, t), this.schedule(), t;
	}
	getCachedUpdates() {
		let e = this.datastore.getObject(V, []);
		return Array.isArray(e) ? e : [];
	}
	schedule() {
		this.timer &&= (clearTimeout(this.timer), null);
		let e = this.getSettings();
		if (e.policy === "manual") return;
		if (e.policy === "startup") {
			this.timer = setTimeout(() => this.runScheduledCheck(), H), this.timer.unref?.();
			return;
		}
		let t = Date.now() - e.lastCheckedAt, n = t >= Jt ? H : Math.max(H, Jt - t);
		this.timer = setTimeout(() => this.runScheduledCheck(), n), this.timer.unref?.();
	}
	stop() {
		this.timer && clearTimeout(this.timer), this.timer = null;
	}
	async runScheduledCheck() {
		try {
			let e = await this.checkForUpdates();
			if (this.getSettings().autoInstall && e.updates.length > 0) {
				let t = await this.updateAll(e.updates.map((e) => e.internalName));
				this.emit("extension:autoUpdateCompleted", {
					result: e,
					outcomes: t
				});
			} else e.updates.length > 0 && this.emit("extension:updatesAvailable", e);
		} catch (e) {
			console.warn("Scheduled extension update check failed:", e);
		} finally {
			this.schedule();
		}
	}
	async checkForUpdates() {
		return this.inFlight ||= this.doCheck().finally(() => {
			this.inFlight = null;
		}), this.inFlight;
	}
	async doCheck() {
		let e = this.plugins.getInstalledRepositories(), t = new Map(this.plugins.getInstalledPluginRecords().map((e) => [e.internalName, e])), n = [], r = /* @__PURE__ */ new Map();
		this.emit("extension:updateCheckStarted", { repositories: e.length }), (await Promise.allSettled(e.map((e) => this.plugins.fetchRepository(e)))).forEach((i, a) => {
			let o = e[a];
			if (i.status === "rejected") {
				n.push(`${o} could not be checked: ${i.reason instanceof Error ? i.reason.message : String(i.reason)}`);
				return;
			}
			n.push(...i.value.warnings);
			for (let e of i.value.plugins) {
				let n = t.get(e.internalName);
				if (!n) continue;
				let i = Number(e.version ?? 0), a = Number(n.version ?? 0);
				if (!Number.isFinite(i) || i <= a) continue;
				let s = r.get(e.internalName);
				s && s.availableVersion >= i || r.set(e.internalName, {
					internalName: e.internalName,
					name: e.name ?? e.internalName,
					installedVersion: a,
					availableVersion: i,
					repositoryUrl: o,
					downloadUrl: e.url,
					fileSize: e.fileSize,
					description: e.description
				});
			}
		});
		let i = [...r.values()].sort((e, t) => e.name.localeCompare(t.name)), a = {
			checkedAt: Date.now(),
			updates: i,
			warnings: n,
			repositoriesChecked: e.length
		};
		return this.datastore.setObject(V, i), this.saveSettings({ lastCheckedAt: a.checkedAt }), this.emit("extension:updateCheckFinished", a), a;
	}
	async updatePlugin(e) {
		let t = this.getCachedUpdates().find((t) => t.internalName === e);
		if (!t) return {
			internalName: e,
			ok: !1,
			message: "No update is known for this extension. Check for updates first."
		};
		this.emit("extension:updateStarted", {
			internalName: e,
			name: t.name
		});
		let n = {
			url: t.downloadUrl,
			status: 1,
			version: t.availableVersion,
			name: t.name,
			internalName: t.internalName,
			repositoryUrl: t.repositoryUrl,
			fileSize: t.fileSize,
			description: t.description
		};
		try {
			let r = (await this.plugins.fetchRepository(t.repositoryUrl)).plugins.find((t) => t.internalName === e);
			r && (n.fileHash = r.fileHash, n.url = r.url, n.version = Number(r.version ?? t.availableVersion));
		} catch {}
		let r = await this.plugins.installPlugin(n, t.repositoryUrl);
		r.ok && this.dropCachedUpdate(e);
		let i = {
			internalName: e,
			ok: r.ok,
			fromVersion: t.installedVersion,
			toVersion: r.ok ? n.version : void 0,
			message: r.ok ? `${t.name} updated from v${t.installedVersion} to v${n.version}.` : r.message
		};
		return this.emit("extension:updateFinished", i), i;
	}
	async updateAll(e) {
		let t = e ?? this.getCachedUpdates().map((e) => e.internalName), n = [];
		for (let e = 0; e < t.length; e++) this.emit("extension:updateProgress", {
			current: e + 1,
			total: t.length,
			internalName: t[e]
		}), n.push(await this.updatePlugin(t[e]));
		let r = n.filter((e) => e.ok).length;
		return this.saveSettings({ lastResult: {
			updateCount: t.length,
			installed: r,
			failed: t.length - r
		} }), n;
	}
	dropCachedUpdate(e) {
		this.datastore.setObject(V, this.getCachedUpdates().filter((t) => t.internalName !== e));
	}
}, Xt = c(import.meta.url), U = s.dirname(Xt), W = null, G = new ae(), Zt = new oe(), K = new ce(G, Zt), q = new Te(G), J = new Ee(), Y = new tt(G.getString("torrent_cache_path", "", !0) || void 0), X = new Kt(G, q, Y), Z = new Yt(G, q);
K.setTorrentEngine(Y);
function Q() {
	W = new t({
		width: 1360,
		height: 860,
		minWidth: 960,
		minHeight: 640,
		title: "CloudStream 3 Desktop",
		backgroundColor: "#0c0f17",
		show: !1,
		webPreferences: {
			preload: s.join(U, "preload.js"),
			contextIsolation: !0,
			nodeIntegration: !1,
			sandbox: !1
		}
	}), n.setApplicationMenu(null), W.once("ready-to-show", () => W?.show()), W.webContents.setWindowOpenHandler(({ url: e }) => (/^https?:\/\//.test(e) && o.openExternal(e), { action: "deny" })), process.env.VITE_DEV_SERVER_URL ? W.loadURL(process.env.VITE_DEV_SERVER_URL) : W.loadFile(s.join(U, "../dist/index.html")), W.on("closed", () => {
		W = null;
	});
}
r.whenReady().then(async () => {
	try {
		await K.start();
	} catch (e) {
		console.warn("DownloadService lazy-start warning:", e);
	}
	K.setProgressCallback((e) => {
		W && !W.isDestroyed() && W.webContents.send("download:progress", e);
	}), Q(), Z.setNotifier((e, t) => {
		W && !W.isDestroyed() && W.webContents.send("extension:updateEvent", e, t);
	}), Z.schedule(), r.on("activate", () => {
		t.getAllWindows().length === 0 && Q();
	});
}), r.on("window-all-closed", () => {
	K.stop(), Z.stop(), q.shutdown(), process.platform !== "darwin" && r.quit();
}), r.on("before-quit", async (e) => {
	if (Y) {
		e.preventDefault();
		try {
			await Y.destroy();
		} catch {}
		r.exit(0);
	}
});
function $(e) {
	return {
		ok: !1,
		error: e instanceof Error ? e.message : String(e)
	};
}
a.handle("api:searchAll", async (e, t) => {
	try {
		return {
			ok: !0,
			results: await X.search(t)
		};
	} catch (e) {
		return {
			...$(e),
			results: []
		};
	}
}), a.handle("api:loadMedia", async (e, t) => {
	try {
		return {
			ok: !0,
			detail: await X.load(t)
		};
	} catch (e) {
		return {
			...$(e),
			detail: null
		};
	}
}), a.handle("api:getSources", async (e, t) => {
	try {
		return {
			ok: !0,
			...await X.getSources(t)
		};
	} catch (e) {
		return {
			...$(e),
			sources: [],
			filtered: [],
			indexerOutcomes: [],
			query: { title: "" }
		};
	}
}), a.handle("api:getPluginRuntimeStatus", async () => q.getRuntimeStatus()), a.handle("extension:getRuntimeReport", async (e, t) => q.getRuntimeReport(t)), a.handle("torrent:startStream", async (e, t, n, r) => {
	try {
		return {
			ok: !0,
			handle: await X.startStream(t, n, r)
		};
	} catch (e) {
		return {
			...$(e),
			handle: null
		};
	}
}), a.handle("torrent:getStats", async (e, t) => Y.getStats(t)), a.handle("torrent:selectFile", async (e, t, n) => Y.selectFile(t, n)), a.handle("torrent:stopStream", async (e, t, n) => {
	await Y.stopStream(t, n ?? !1);
}), a.handle("torrent:getActiveStreams", async () => Y.getActiveStreams()), a.handle("torrent:clearCache", async () => {
	try {
		return {
			ok: !0,
			removed: await Y.clearCache()
		};
	} catch (e) {
		return {
			...$(e),
			removed: 0
		};
	}
}), a.handle("torrent:getCachePath", async () => Y.getCachePath()), a.handle("indexer:getConfigs", async () => X.getRegistry().getConfigs()), a.handle("indexer:saveConfig", async (e, t) => (X.getRegistry().upsertConfig(t), X.getRegistry().getConfigs())), a.handle("indexer:removeConfig", async (e, t) => (X.getRegistry().removeConfig(t), X.getRegistry().getConfigs())), a.handle("indexer:test", async (e, t) => X.getRegistry().testIndexer(t)), a.handle("indexer:getHealth", async () => X.getRegistry().getHealth()), a.handle("sources:getPreferences", async () => X.getPreferences()), a.handle("sources:savePreferences", async (e, t) => X.savePreferences(t)), a.handle("download:enqueue", async (e, t) => K.enqueue(t)), a.handle("download:pause", async (e, t) => K.pause(t)), a.handle("download:resume", async (e, t) => K.resume(t)), a.handle("download:remove", async (e, t) => K.remove(t)), a.handle("download:getQueue", async () => K.getTasks()), a.handle("download:revealInFolder", async (e, t) => {
	o.showItemInFolder(t);
}), a.handle("binary:check", async () => J.checkBinaries()), a.handle("binary:setup", async () => {
	try {
		let e = await J.setupAria2(), t = await J.setupYtDlp();
		return e && await Zt.start(), {
			success: e || t,
			message: e ? "aria2c and yt-dlp downloaded and configured." : t ? "yt-dlp configured; aria2c setup failed." : "Binary setup failed."
		};
	} catch (e) {
		return {
			success: !1,
			message: e?.message || "Failed to set up binaries"
		};
	}
}), a.handle("extension:getOfficialRepositories", async () => De), a.handle("extension:fetchRepository", async (e, t) => {
	try {
		return {
			ok: !0,
			repository: await q.fetchRepository(t)
		};
	} catch (e) {
		return {
			...$(e),
			repository: null
		};
	}
}), a.handle("extension:analyzePlugin", async (e, t) => q.analyzePlugin(t)), a.handle("extension:installPlugin", async (e, t, n) => q.installPlugin(t, n)), a.handle("extension:uninstallPlugin", async (e, t) => q.uninstallPlugin(t)), a.handle("extension:getInstalledRepositories", async () => q.getInstalledRepositories()), a.handle("extension:removeRepository", async (e, t) => (q.removeRepository(t), q.getInstalledRepositories())), a.handle("extension:getInstalledPlugins", async () => q.getInstalledPlugins()), a.handle("extension:checkUpdates", async () => {
	try {
		return {
			ok: !0,
			result: await Z.checkForUpdates()
		};
	} catch (e) {
		return {
			...$(e),
			result: null
		};
	}
}), a.handle("extension:getCachedUpdates", async () => Z.getCachedUpdates()), a.handle("extension:update", async (e, t) => Z.updatePlugin(t)), a.handle("extension:updateAll", async (e, t) => Z.updateAll(t)), a.handle("extension:getUpdateSettings", async () => Z.getSettings()), a.handle("extension:saveUpdateSettings", async (e, t) => Z.saveSettings(t)), a.handle("datastore:getSetting", async (e, t, n) => G.getString(t, n, !0)), a.handle("datastore:setSetting", async (e, t, n) => {
	G.setString(t, String(n), !0);
}), a.handle("datastore:getObject", async (e, t, n) => G.getObject(t, n)), a.handle("datastore:setObject", async (e, t, n) => {
	G.setObject(t, n);
}), a.handle("datastore:importBackup", async (e, t) => G.importBackupFile(t)), a.handle("datastore:exportBackup", async () => G.exportBackup()), a.handle("dialog:selectDirectory", async () => {
	if (!W) return null;
	let e = await i.showOpenDialog(W, { properties: ["openDirectory"] });
	return e.canceled || e.filePaths.length === 0 ? null : e.filePaths[0];
});
//#endregion
export {};
