import { contextBridge, ipcRenderer } from "electron";
//#region electron/preload.ts
contextBridge.exposeInMainWorld("cloudstream", {
	searchAll: (query, targetProviders) => ipcRenderer.invoke("api:searchAll", query, targetProviders),
	loadMedia: (apiName, url) => ipcRenderer.invoke("api:loadMedia", apiName, url),
	loadLinks: (apiName, url) => ipcRenderer.invoke("api:loadLinks", apiName, url),
	getProvidersList: () => ipcRenderer.invoke("api:getProvidersList"),
	enqueueDownload: (task) => ipcRenderer.invoke("download:enqueue", task),
	pauseDownload: (id) => ipcRenderer.invoke("download:pause", id),
	resumeDownload: (id) => ipcRenderer.invoke("download:resume", id),
	removeDownload: (id) => ipcRenderer.invoke("download:remove", id),
	getDownloadQueue: () => ipcRenderer.invoke("download:getQueue"),
	onDownloadProgress: (callback) => {
		ipcRenderer.on("download:progress", (_, tasks) => callback(tasks));
	},
	checkBinaries: () => ipcRenderer.invoke("binary:check"),
	setupBinaries: () => ipcRenderer.invoke("binary:setup"),
	getOfficialRepositories: () => ipcRenderer.invoke("extension:getOfficialRepositories"),
	fetchRepository: (repoUrl) => ipcRenderer.invoke("extension:fetchRepository", repoUrl),
	analyzePlugin: (plugin) => ipcRenderer.invoke("extension:analyzePlugin", plugin),
	installPlugin: (plugin) => ipcRenderer.invoke("extension:installPlugin", plugin),
	getInstalledRepositories: () => ipcRenderer.invoke("extension:getInstalledRepositories"),
	getInstalledPlugins: () => ipcRenderer.invoke("extension:getInstalledPlugins"),
	getSetting: (key, defaultValue) => ipcRenderer.invoke("datastore:getSetting", key, defaultValue),
	setSetting: (key, value) => ipcRenderer.invoke("datastore:setSetting", key, value),
	importBackup: (filePath) => ipcRenderer.invoke("datastore:importBackup", filePath),
	exportBackup: () => ipcRenderer.invoke("datastore:exportBackup"),
	selectDirectory: () => ipcRenderer.invoke("dialog:selectDirectory")
});
//#endregion
export {};
