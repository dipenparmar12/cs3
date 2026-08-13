import { contextBridge as e, ipcRenderer as t } from "electron";
//#region electron/preload.ts
e.exposeInMainWorld("cloudstream", {
	searchAll: (e) => t.invoke("api:searchAll", e),
	loadMedia: (e) => t.invoke("api:loadMedia", e),
	getSources: (e) => t.invoke("api:getSources", e),
	getPluginRuntimeStatus: () => t.invoke("api:getPluginRuntimeStatus"),
	startStream: (e, n, r) => t.invoke("torrent:startStream", e, n, r),
	startBestStream: (e, n, r) => t.invoke("torrent:startBestStream", e, n, r),
	autoPlay: (e) => t.invoke("torrent:autoPlay", e),
	getStreamStats: (e) => t.invoke("torrent:getStats", e),
	selectStreamFile: (e, n) => t.invoke("torrent:selectFile", e, n),
	stopStream: (e, n) => t.invoke("torrent:stopStream", e, n),
	getActiveStreams: () => t.invoke("torrent:getActiveStreams"),
	clearTorrentCache: () => t.invoke("torrent:clearCache"),
	getTorrentCachePath: () => t.invoke("torrent:getCachePath"),
	getIndexerConfigs: () => t.invoke("indexer:getConfigs"),
	saveIndexerConfig: (e) => t.invoke("indexer:saveConfig", e),
	removeIndexerConfig: (e) => t.invoke("indexer:removeConfig", e),
	testIndexer: (e) => t.invoke("indexer:test", e),
	getIndexerHealth: () => t.invoke("indexer:getHealth"),
	getSourcePreferences: () => t.invoke("sources:getPreferences"),
	saveSourcePreferences: (e) => t.invoke("sources:savePreferences", e),
	enqueueDownload: (e) => t.invoke("download:enqueue", e),
	pauseDownload: (e) => t.invoke("download:pause", e),
	resumeDownload: (e) => t.invoke("download:resume", e),
	removeDownload: (e) => t.invoke("download:remove", e),
	getDownloadQueue: () => t.invoke("download:getQueue"),
	revealInFolder: (e) => t.invoke("download:revealInFolder", e),
	onDownloadProgress: (e) => {
		let n = (t, n) => e(n);
		return t.on("download:progress", n), () => t.removeListener("download:progress", n);
	},
	startBatchDownload: (e) => t.invoke("download:startBatch", e),
	cancelBatchDownload: (e) => t.invoke("download:cancelBatch", e),
	getActiveBatches: () => t.invoke("download:getActiveBatches"),
	onBatchProgress: (e) => {
		let n = (t, n) => e(n);
		return t.on("download:batchProgress", n), () => t.removeListener("download:batchProgress", n);
	},
	checkBinaries: () => t.invoke("binary:check"),
	setupBinaries: () => t.invoke("binary:setup"),
	getOfficialRepositories: () => t.invoke("extension:getOfficialRepositories"),
	fetchRepository: (e) => t.invoke("extension:fetchRepository", e),
	analyzePlugin: (e) => t.invoke("extension:analyzePlugin", e),
	installPlugin: (e, n) => t.invoke("extension:installPlugin", e, n),
	uninstallPlugin: (e) => t.invoke("extension:uninstallPlugin", e),
	getInstalledRepositories: () => t.invoke("extension:getInstalledRepositories"),
	removeRepository: (e) => t.invoke("extension:removeRepository", e),
	getInstalledPlugins: () => t.invoke("extension:getInstalledPlugins"),
	checkExtensionUpdates: () => t.invoke("extension:checkUpdates"),
	getCachedExtensionUpdates: () => t.invoke("extension:getCachedUpdates"),
	updateExtension: (e) => t.invoke("extension:update", e),
	updateAllExtensions: (e) => t.invoke("extension:updateAll", e),
	getUpdateSettings: () => t.invoke("extension:getUpdateSettings"),
	saveUpdateSettings: (e) => t.invoke("extension:saveUpdateSettings", e),
	onExtensionUpdateEvent: (e) => {
		let n = (t, n, r) => e(n, r);
		return t.on("extension:updateEvent", n), () => t.removeListener("extension:updateEvent", n);
	},
	getLibraryEntries: (e) => t.invoke("library:getEntries", e),
	upsertLibraryEntry: (e) => t.invoke("library:upsertEntry", e),
	setLibraryStatus: (e, n) => t.invoke("library:setStatus", e, n),
	setLibraryUserRating: (e, n) => t.invoke("library:setUserRating", e, n),
	removeLibraryEntry: (e) => t.invoke("library:removeEntry", e),
	getLibraryEntryForUrl: (e) => t.invoke("library:getEntryForUrl", e),
	recordWatchProgress: (e) => t.invoke("library:recordProgress", e),
	getProgressForKey: (e) => t.invoke("library:getProgressForKey", e),
	getContinueWatching: (e) => t.invoke("library:getContinueWatching", e),
	clearWatchProgress: (e, n, r) => t.invoke("library:clearProgress", e, n, r),
	rememberSource: (e) => t.invoke("library:rememberSource", e),
	recallSource: (e, n, r) => t.invoke("library:recallSource", e, n, r),
	exportLibrary: () => t.invoke("library:export"),
	importLibrary: (e) => t.invoke("library:import", e),
	getSetting: (e, n) => t.invoke("datastore:getSetting", e, n),
	setSetting: (e, n) => t.invoke("datastore:setSetting", e, n),
	getObject: (e, n) => t.invoke("datastore:getObject", e, n),
	setObject: (e, n) => t.invoke("datastore:setObject", e, n),
	importBackup: (e) => t.invoke("datastore:importBackup", e),
	exportBackup: () => t.invoke("datastore:exportBackup"),
	selectDirectory: () => t.invoke("dialog:selectDirectory")
});
//#endregion
export {};
