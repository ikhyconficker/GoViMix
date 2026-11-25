const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('govimixDesktop', {
  isDesktop: true,
  platform: process.platform,
  arch: process.arch,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
});
