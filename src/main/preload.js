const { contextBridge, ipcRenderer } = require('electron');

// Expose selected APIs to the renderer process
contextBridge.exposeInMainWorld('api', {
  // File dialog for opening video files
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),

  // Video-related database operations
  addVideo: (filePath) => ipcRenderer.invoke('db-add-video', filePath),
  getVideos: () => ipcRenderer.invoke('db-get-videos'),

  // Event-related database operations
  // net and result are optional; supply them for shot-against events
  addEvent: (videoId, eventTypeId, timestamp, net, result) =>
    ipcRenderer.invoke('db-add-event', videoId, eventTypeId, timestamp, net, result),
  addEventPlayerAssociation: (eventId, playerId) =>
    ipcRenderer.invoke('db-add-event-player-association', eventId, playerId),
  getVideoEvents: (videoId) => ipcRenderer.invoke('db-get-video-events', videoId),
  getEvent: (eventId) => ipcRenderer.invoke('db-get-event', eventId),
  updateEventPlayers: (eventId, playerIds) =>
    ipcRenderer.invoke('db-update-event-players', eventId, playerIds),
  deleteEvent: (eventId) => ipcRenderer.invoke('db-delete-event', eventId),

  // Player-related database operations
  getPlayers: () => ipcRenderer.invoke('db-get-players'),
  addPlayer: (name) => ipcRenderer.invoke('db-add-player', name),
  updatePlayer: (id, name) => ipcRenderer.invoke('db-update-player', id, name),
  deletePlayer: (id) => ipcRenderer.invoke('db-delete-player', id),
  getPlayerEvents: (playerId) => ipcRenderer.invoke('db-get-player-events', playerId),
  setMyGoalie: (playerId) => ipcRenderer.invoke('db-set-my-goalie', playerId),

  // Event types operations
  getEventTypes: () => ipcRenderer.invoke('db-get-event-types'),
  addEventType: (name, isCustom) => ipcRenderer.invoke('db-add-event-type', name, isCustom),

  // Goalie stat operations
  getGoalieLine: (videoId) => ipcRenderer.invoke('db-get-goalie-line', videoId),
  getShots: (videoId) => ipcRenderer.invoke('db-get-shots', videoId)
});
