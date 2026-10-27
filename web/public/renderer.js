/**
 * renderer.js -- Web port of the Electron renderer.
 *
 * Changes from the original:
 *   - window.api.* IPC calls -> fetch() calls to the local Express server
 *   - File picker (Electron dialog) -> upload form with progress
 *   - Video src is /videos/<filename> served by the server (with byte-range support)
 *   - Upload flow added
 *   - game_date and competition_id added to videos (Phase 2)
 */

// ---------------------------------------------------------------------------
// API shim: same method names as window.api in the Electron app
// ---------------------------------------------------------------------------
const api = {
  getVideos: () => fetch('/api/videos').then(r => r.json()),
  addEvent: (videoId, eventTypeId, timestamp) =>
    fetch('/api/events', { method: 'POST', headers: jsonH(), body: JSON.stringify({ videoId, eventTypeId, timestamp }) }).then(r => r.json()),
  addEventPlayerAssociation: (eventId, playerId) =>
    fetch(`/api/events/${eventId}/players`, { method: 'POST', headers: jsonH(), body: JSON.stringify({ playerId }) }).then(r => r.json()),
  getVideoEvents: (videoId) => fetch(`/api/events?videoId=${videoId}`).then(r => r.json()),
  getEvent: (eventId) => fetch(`/api/events/${eventId}`).then(r => r.json()),
  updateEventPlayers: (eventId, playerIds) =>
    fetch(`/api/events/${eventId}/players`, { method: 'PUT', headers: jsonH(), body: JSON.stringify({ playerIds }) }).then(r => r.json()),
  deleteEvent: (eventId) =>
    fetch(`/api/events/${eventId}`, { method: 'DELETE' }).then(r => r.json()),
  getPlayers: () => fetch('/api/players').then(r => r.json()),
  addPlayer: (name) =>
    fetch('/api/players', { method: 'POST', headers: jsonH(), body: JSON.stringify({ name }) }).then(r => r.json()),
  updatePlayer: (id, name) =>
    fetch(`/api/players/${id}`, { method: 'PUT', headers: jsonH(), body: JSON.stringify({ name }) }).then(r => r.json()),
  deletePlayer: (id) =>
    fetch(`/api/players/${id}`, { method: 'DELETE' }).then(r => r.json()),
  getPlayerEvents: (playerId) => fetch(`/api/players/${playerId}/events`).then(r => r.json()),
  getEventTypes: () => fetch('/api/event-types').then(r => r.json()),
  addEventType: (name, isCustom) =>
    fetch('/api/event-types', { method: 'POST', headers: jsonH(), body: JSON.stringify({ name, is_custom: isCustom }) }).then(r => r.json()),
  getCompetitions: () => fetch('/api/competitions').then(r => r.json()),
  addCompetition: (name) =>
    fetch('/api/competitions', { method: 'POST', headers: jsonH(), body: JSON.stringify({ name }) }).then(r => r.json()),
  updateVideoMeta: (id, game_date, competition_id) =>
    fetch(`/api/videos/${id}`, { method: 'PATCH', headers: jsonH(), body: JSON.stringify({ game_date, competition_id }) }).then(r => r.json()),
};

function jsonH() { return { 'Content-Type': 'application/json' }; }

// ---------------------------------------------------------------------------
// Main app logic -- runs when the DOM is ready
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  // Film-review constants
  const FRAME_RATE = 30;          // assumed FPS for frame stepping
  const FRAME_SEC  = 1 / FRAME_RATE;

  // Initialize Video.js with playback rate selector in the native control bar
  const player = videojs('hockey-video', {
    controls: true,
    autoplay: false,
    preload: 'auto',
    fluid: true,
    playbackRates: [0.25, 0.5, 0.75, 1, 1.5, 2],
    controlBar: {
      playbackRateMenuButton: true,
    },
  });

  // Try to init the annotation plugin (optional, graceful fallback)
  try {
    if (typeof videojs.annotationComments === 'function') {
      const ac = videojs.annotationComments(player, {
        annotationsObjects: [],
        meta: { user_id: 1, user_name: 'Coach' },
      });
      player.annotationComments = () => ({
        addAnnotation(a) {
          ac.add({
            range: { start: a.range.start, end: a.range.end || a.range.start + 0.5 },
            text: a.commentStr,
            meta: a.meta,
          });
        },
        clearAll() { ac.removeAll(); },
      });
    } else {
      console.warn('VideoJS Annotation Comments plugin not available');
    }
  } catch (e) {
    console.error('Error initializing annotation system:', e);
  }

  // DOM refs
  const tabButtons         = document.querySelectorAll('.tab-button');
  const tabContents        = document.querySelectorAll('.tab-content');
  const videoSelectEl      = document.getElementById('video-select');
  const eventTypeButtons   = document.getElementById('event-type-buttons');
  const playerSelectionEl  = document.getElementById('player-selection');
  const addCustomEventBtn  = document.getElementById('add-custom-event-btn');
  const eventsListEl       = document.getElementById('events-list');
  const playerListEl       = document.getElementById('player-list');
  const playerEventsEl     = document.getElementById('player-events');
  const selectedPlayerName = document.getElementById('selected-player-name');
  const addPlayerBtn       = document.getElementById('add-player-btn');
  const addPlayerProfileBtn = document.getElementById('add-player-profile-btn');

  // Game info bar
  const gameInfoBar        = document.getElementById('game-info-bar');
  const gameInfoDateEl     = document.getElementById('game-info-date');
  const gameInfoCompEl     = document.getElementById('game-info-competition');
  const editGameInfoBtn    = document.getElementById('edit-game-info-btn');

  // Generic modal
  const modal        = document.getElementById('modal');
  const modalTitle   = document.getElementById('modal-title');
  const modalInput   = document.getElementById('modal-input');
  const modalSaveBtn = document.getElementById('modal-save-btn');
  document.getElementById('modal-close').onclick   = () => modal.style.display = 'none';
  document.getElementById('modal-cancel-btn').onclick = () => modal.style.display = 'none';

  // Event edit modal
  const eventEditModal      = document.getElementById('event-edit-modal');
  const editEventTypeEl     = document.getElementById('edit-event-type');
  const editEventTimestamp  = document.getElementById('edit-event-timestamp');
  const editPlayerSelection = document.getElementById('edit-player-selection');
  const eventEditSaveBtn    = document.getElementById('event-edit-save-btn');
  const eventDeleteBtn      = document.getElementById('event-delete-btn');
  document.getElementById('event-edit-close').onclick      = () => eventEditModal.style.display = 'none';
  document.getElementById('event-edit-cancel-btn').onclick = () => eventEditModal.style.display = 'none';

  // Upload modal
  const uploadModal     = document.getElementById('upload-modal');
  const uploadDropZone  = document.getElementById('upload-drop-zone');
  const fileInput       = document.getElementById('file-input');
  const uploadProgress  = document.getElementById('upload-progress');
  const progressFill    = document.getElementById('progress-fill');
  const progressLabel   = document.getElementById('progress-label');
  const uploadErrorEl   = document.getElementById('upload-error');
  const uploadGameDate  = document.getElementById('upload-game-date');
  const uploadCompSelect = document.getElementById('upload-competition');
  document.getElementById('upload-modal-close').onclick = () => uploadModal.style.display = 'none';
  document.getElementById('pick-file-btn').onclick = () => fileInput.click();

  // Game info edit modal
  const gameInfoModal        = document.getElementById('game-info-modal');
  const gameInfoDateInput    = document.getElementById('game-info-date-input');
  const gameInfoCompSelect   = document.getElementById('game-info-competition-select');
  const gameInfoSaveBtn      = document.getElementById('game-info-save-btn');
  document.getElementById('game-info-modal-close').onclick = () => gameInfoModal.style.display = 'none';
  document.getElementById('game-info-cancel-btn').onclick  = () => gameInfoModal.style.display = 'none';

  // Competitions management modal
  const competitionsModal    = document.getElementById('competitions-modal');
  const competitionsList     = document.getElementById('competitions-list');
  const addCompetitionBtn    = document.getElementById('add-competition-btn');
  document.getElementById('competitions-modal-close').onclick = () => competitionsModal.style.display = 'none';
  document.getElementById('manage-competitions-btn').onclick  = openCompetitionsModal;

  // Close modals when clicking backdrop
  window.addEventListener('click', e => {
    if (e.target === modal)             modal.style.display = 'none';
    if (e.target === eventEditModal)    eventEditModal.style.display = 'none';
    if (e.target === uploadModal)       uploadModal.style.display = 'none';
    if (e.target === gameInfoModal)     gameInfoModal.style.display = 'none';
    if (e.target === competitionsModal) competitionsModal.style.display = 'none';
  });

  // App state
  let currentVideoId = null;
  let currentVideoMeta = null; // full video row from API
  let players = [];
  let eventTypes = [];
  let competitions = [];
  let selectedPlayerId = null;
  let currentEditEventId = null;
  let currentVideoEvents = [];   // events for the loaded video (for prev/next nav)

  const shortcutKeys = [
    '1','2','3','4','5','6','7','8','9','0',
    'Q','W','E','R','T','Y','U','I','O','P',
  ];

  // -------------------------------------------------------------------------
  // Film controls setup
  // -------------------------------------------------------------------------
  const filmControls     = document.getElementById('film-controls');
  const filmTimeDisplay  = document.getElementById('film-time-display');
  const playPauseBtn     = document.getElementById('btn-play-pause');
  const speedBtns        = document.querySelectorAll('.film-speed-btn');

  // Helper: clamp time into valid range
  function clampTime(t) {
    return Math.max(0, Math.min(t, player.duration() || 0));
  }

  // Play/pause button label sync
  function syncPlayPauseBtn() {
    playPauseBtn.textContent = player.paused() ? '▶' : '⏸';
  }
  player.on('play',  syncPlayPauseBtn);
  player.on('pause', syncPlayPauseBtn);

  // Time display update
  player.on('timeupdate', () => {
    const cur = player.currentTime() || 0;
    const dur = player.duration()    || 0;
    filmTimeDisplay.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
  });
  player.on('loadedmetadata', () => {
    const dur = player.duration() || 0;
    filmTimeDisplay.textContent = `00:00 / ${formatTime(dur)}`;
  });

  // Speed buttons
  speedBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const rate = parseFloat(btn.dataset.rate);
      player.playbackRate(rate);
      speedBtns.forEach(b => b.classList.toggle('active', b === btn));
    });
  });
  // Sync speed buttons when rate changes externally (e.g. via video.js control bar)
  player.on('ratechange', () => {
    const rate = player.playbackRate();
    speedBtns.forEach(b => b.classList.toggle('active', parseFloat(b.dataset.rate) === rate));
  });

  // Film control buttons
  playPauseBtn.addEventListener('click', () => {
    if (player.paused()) player.play(); else player.pause();
  });

  document.getElementById('btn-skip-back-10').addEventListener('click',  () => player.currentTime(clampTime(player.currentTime() - 10)));
  document.getElementById('btn-skip-back-5').addEventListener('click',   () => player.currentTime(clampTime(player.currentTime() - 5)));
  document.getElementById('btn-frame-back').addEventListener('click',    () => { player.pause(); player.currentTime(clampTime(player.currentTime() - FRAME_SEC)); });
  document.getElementById('btn-frame-fwd').addEventListener('click',     () => { player.pause(); player.currentTime(clampTime(player.currentTime() + FRAME_SEC)); });
  document.getElementById('btn-skip-fwd-5').addEventListener('click',    () => player.currentTime(clampTime(player.currentTime() + 5)));
  document.getElementById('btn-skip-fwd-10').addEventListener('click',   () => player.currentTime(clampTime(player.currentTime() + 10)));
  document.getElementById('btn-replay-10').addEventListener('click',     () => { player.currentTime(clampTime(player.currentTime() - 10)); player.play(); });

  document.getElementById('btn-prev-event').addEventListener('click', () => {
    const t = player.currentTime();
    // Find the last event strictly before current time (with a tiny buffer so we can step back from exactly on one)
    const prev = [...currentVideoEvents].reverse().find(ev => ev.timestamp < t - 0.1);
    if (prev) player.currentTime(prev.timestamp);
  });

  document.getElementById('btn-next-event').addEventListener('click', () => {
    const t = player.currentTime();
    const next = currentVideoEvents.find(ev => ev.timestamp > t + 0.1);
    if (next) player.currentTime(next.timestamp);
  });

  // -------------------------------------------------------------------------
  // Tab navigation
  // -------------------------------------------------------------------------
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
    });
  });

  // -------------------------------------------------------------------------
  // Initial data load
  // -------------------------------------------------------------------------
  loadEventTypes();
  loadPlayers();
  loadCompetitions().then(() => loadVideoList());

  // -------------------------------------------------------------------------
  // Competitions
  // -------------------------------------------------------------------------
  async function loadCompetitions() {
    try {
      competitions = await api.getCompetitions();
    } catch (err) {
      console.error('Error loading competitions:', err);
    }
  }

  function populateCompetitionSelect(selectEl, selectedId) {
    selectEl.innerHTML = '<option value="">(none)</option>';
    competitions.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      if (c.id === selectedId) opt.selected = true;
      selectEl.appendChild(opt);
    });
  }

  async function openCompetitionsModal() {
    await loadCompetitions();
    competitionsList.innerHTML = '';
    competitions.forEach(c => {
      const li = document.createElement('li');
      li.className = 'player-item';
      const nameSpan = document.createElement('span');
      nameSpan.textContent = c.name + (c.is_custom ? '' : ' (default)');
      li.appendChild(nameSpan);
      competitionsList.appendChild(li);
    });
    competitionsModal.style.display = 'block';
  }

  addCompetitionBtn.addEventListener('click', () => {
    showModal('Add Custom Competition', 'Competition name (e.g. Tournament A)', async name => {
      const result = await api.addCompetition(name);
      competitions.push(result);
      // refresh list
      await openCompetitionsModal();
      await loadVideoList();
    });
  });

  // -------------------------------------------------------------------------
  // Video list (previously uploaded)
  // -------------------------------------------------------------------------
  async function loadVideoList() {
    const videos = await api.getVideos().catch(() => []);

    // Build grouped select: group by competition_name, order by date within group.
    // API already returns rows latest-first per competition via ORDER BY.
    videoSelectEl.innerHTML = '<option value="">-- or select a previous game --</option>';

    // Group the videos by competition
    const groups = new Map(); // competition_name -> [video]
    const noComp = [];
    videos.forEach(v => {
      if (v.competition_name) {
        if (!groups.has(v.competition_name)) groups.set(v.competition_name, []);
        groups.get(v.competition_name).push(v);
      } else {
        noComp.push(v);
      }
    });

    function makeOption(v) {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.dataset.filePath = v.file_path;
      opt.dataset.gameDate = v.game_date || '';
      opt.dataset.competitionId = v.competition_id || '';
      opt.dataset.competitionName = v.competition_name || '';
      const label = v.file_path.replace(/^\d+_/, '');
      const datePart = v.game_date ? ` (${v.game_date})` : '';
      opt.textContent = label + datePart;
      return opt;
    }

    groups.forEach((vids, compName) => {
      const group = document.createElement('optgroup');
      group.label = compName;
      vids.forEach(v => group.appendChild(makeOption(v)));
      videoSelectEl.appendChild(group);
    });

    if (noComp.length > 0) {
      const group = document.createElement('optgroup');
      group.label = 'Uncategorized';
      noComp.forEach(v => group.appendChild(makeOption(v)));
      videoSelectEl.appendChild(group);
    }
  }

  videoSelectEl.addEventListener('change', () => {
    const opt = videoSelectEl.selectedOptions[0];
    if (!opt || !opt.value) return;
    const id   = parseInt(opt.value, 10);
    const file = opt.dataset.filePath;
    openVideo(id, file, opt.textContent, {
      game_date: opt.dataset.gameDate || null,
      competition_id: opt.dataset.competitionId ? parseInt(opt.dataset.competitionId) : null,
      competition_name: opt.dataset.competitionName || null,
    });
  });

  function openVideo(videoId, filePath, displayName, meta) {
    currentVideoId = videoId;
    currentVideoMeta = meta || {};
    const displayTitle = displayName || filePath.replace(/^\d+_/, '');
    updateGameInfoBar(displayTitle, meta);
    player.src({ src: `/videos/${filePath}`, type: 'video/mp4' });
    // Show film controls now that a video is loaded
    filmControls.style.display = '';
    // Reset speed display to 1x
    speedBtns.forEach(b => b.classList.toggle('active', b.dataset.rate === '1'));
    loadVideoEvents(videoId);
  }

  function updateGameInfoBar(displayTitle, meta) {
    gameInfoBar.style.display = 'flex';
    const date = meta && meta.game_date ? meta.game_date : 'No date set';
    const comp = meta && meta.competition_name ? meta.competition_name : 'No competition set';
    gameInfoDateEl.textContent = `Date: ${date}`;
    gameInfoCompEl.textContent = `Competition: ${comp}`;
  }

  // Edit game info
  editGameInfoBtn.addEventListener('click', () => {
    populateCompetitionSelect(gameInfoCompSelect, currentVideoMeta && currentVideoMeta.competition_id ? parseInt(currentVideoMeta.competition_id) : null);
    gameInfoDateInput.value = (currentVideoMeta && currentVideoMeta.game_date) ? currentVideoMeta.game_date : '';
    gameInfoModal.style.display = 'block';
  });

  gameInfoSaveBtn.addEventListener('click', async () => {
    if (!currentVideoId) return;
    const newDate = gameInfoDateInput.value || null;
    const newCompId = gameInfoCompSelect.value ? parseInt(gameInfoCompSelect.value) : null;
    try {
      const updated = await api.updateVideoMeta(currentVideoId, newDate, newCompId);
      currentVideoMeta = updated;
      const compRow = competitions.find(c => c.id === newCompId);
      currentVideoMeta.competition_name = compRow ? compRow.name : null;
      // Update the current option in the select
      const opt = videoSelectEl.querySelector(`option[value="${currentVideoId}"]`);
      if (opt) {
        opt.dataset.gameDate = newDate || '';
        opt.dataset.competitionId = newCompId || '';
        opt.dataset.competitionName = currentVideoMeta.competition_name || '';
        const label = updated.file_path.replace(/^\d+_/, '');
        const datePart = newDate ? ` (${newDate})` : '';
        opt.textContent = label + datePart;
      }
      updateGameInfoBar(null, currentVideoMeta);
      gameInfoModal.style.display = 'none';
      // Reload the full list to re-group if competition changed
      await loadVideoList();
    } catch (err) {
      alert('Failed to save game info: ' + err.message);
    }
  });

  // -------------------------------------------------------------------------
  // Upload flow
  // -------------------------------------------------------------------------
  document.getElementById('upload-video-btn').addEventListener('click', () => {
    uploadErrorEl.style.display = 'none';
    uploadProgress.style.display = 'none';
    progressFill.style.width = '0%';
    // Default date to today
    uploadGameDate.value = new Date().toISOString().slice(0, 10);
    // Populate competition select, default to Regular season
    const defaultComp = competitions.find(c => c.name === 'Regular season');
    populateCompetitionSelect(uploadCompSelect, defaultComp ? defaultComp.id : null);
    uploadModal.style.display = 'block';
  });

  // Drag and drop
  uploadDropZone.addEventListener('dragover', e => {
    e.preventDefault();
    uploadDropZone.classList.add('drag-over');
  });
  uploadDropZone.addEventListener('dragleave', () => uploadDropZone.classList.remove('drag-over'));
  uploadDropZone.addEventListener('drop', e => {
    e.preventDefault();
    uploadDropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files?.[0];
    if (file) startUpload(file);
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) startUpload(file);
    fileInput.value = '';
  });

  async function startUpload(file) {
    // Client-side format check
    const ext = file.name.split('.').pop().toLowerCase();
    const rejected = ['mov','avi','mkv','wmv'];
    if (rejected.includes(ext)) {
      uploadErrorEl.textContent =
        `Unsupported format: .${ext} files do not play in browsers. ` +
        `Please export your game recording as MP4 (H.264) and upload that.`;
      uploadErrorEl.style.display = '';
      return;
    }
    if (!['mp4','webm'].includes(ext)) {
      uploadErrorEl.textContent = `Unsupported format: .${ext}. Please use MP4 or WebM.`;
      uploadErrorEl.style.display = '';
      return;
    }

    uploadErrorEl.style.display = 'none';
    uploadProgress.style.display = '';
    progressFill.style.width = '5%';
    progressLabel.textContent = 'Uploading...';

    try {
      const formData = new FormData();
      formData.append('video', file);
      if (uploadGameDate.value) formData.append('game_date', uploadGameDate.value);
      if (uploadCompSelect.value) formData.append('competition_id', uploadCompSelect.value);

      // Use XMLHttpRequest so we get upload progress
      const result = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/upload');

        xhr.upload.addEventListener('progress', e => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 95);
            progressFill.style.width = `${pct}%`;
            const mb = (e.loaded / 1024 / 1024).toFixed(1);
            const total = (e.total / 1024 / 1024).toFixed(1);
            progressLabel.textContent = `Uploading ${mb} / ${total} MB...`;
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try { resolve(JSON.parse(xhr.responseText)); }
            catch { reject(new Error('Invalid server response')); }
          } else {
            try {
              const err = JSON.parse(xhr.responseText);
              reject(new Error(err.error || `Upload failed: HTTP ${xhr.status}`));
            } catch {
              reject(new Error(`Upload failed: HTTP ${xhr.status}`));
            }
          }
        });

        xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
        xhr.send(formData);
      });

      progressFill.style.width = '100%';
      progressLabel.textContent = 'Upload complete!';

      await loadVideoList();

      // Select and open the newly uploaded video
      for (const opt of videoSelectEl.options) {
        if (parseInt(opt.value, 10) === result.id) {
          videoSelectEl.value = opt.value;
          break;
        }
      }

      uploadModal.style.display = 'none';
      openVideo(result.id, result.file_path, file.name, {
        game_date: result.game_date,
        competition_id: result.competition_id,
        competition_name: competitions.find(c => c.id === result.competition_id)?.name || null,
      });

    } catch (err) {
      uploadErrorEl.textContent = `Upload failed: ${err.message}`;
      uploadErrorEl.style.display = '';
      progressFill.style.width = '0%';
    }
  }

  // -------------------------------------------------------------------------
  // Event tagging (same logic as original renderer)
  // -------------------------------------------------------------------------
  async function tagEvent(eventTypeId) {
    if (!currentVideoId) {
      alert('Please load a video first');
      return;
    }

    const timestamp = player.currentTime();

    try {
      const eventResult = await api.addEvent(currentVideoId, eventTypeId, timestamp);

      const selectedPlayers = Array.from(
        document.querySelectorAll('#player-selection .player-checkbox input:checked')
      ).map(cb => parseInt(cb.value, 10));

      for (const playerId of selectedPlayers) {
        await api.addEventPlayerAssociation(eventResult.id, playerId);
      }

      const eventType = eventTypes.find(et => et.id === eventTypeId);
      const playerNames = selectedPlayers
        .map(pid => players.find(p => p.id === pid)?.name ?? '')
        .filter(Boolean)
        .join(', ');

      if (player.annotationComments) {
        player.annotationComments().addAnnotation({
          id: eventResult.id,
          range: { start: timestamp, end: timestamp + 0.5 },
          commentStr: `${eventType?.name ?? ''}${playerNames ? ': ' + playerNames : ''}`,
          meta: { datetime: new Date().toISOString(), user_id: 1, user_name: 'Coach' },
        });
      }

      loadVideoEvents(currentVideoId);
    } catch (err) {
      console.error('Error tagging event:', err);
      alert('Failed to tag event: ' + err.message);
    }
  }

  function handleEventButtonClick(eventTypeId) {
    document.querySelectorAll('.event-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.id, 10) === eventTypeId);
    });
    tagEvent(eventTypeId);
  }

  // Keyboard shortcuts
  // Primary: 1-0, Q-P = tag events (unchanged)
  // Secondary (film review, only when no input focused):
  //   Space = play/pause
  //   Left / Right = -5s / +5s
  //   Shift+Left / Shift+Right = -10s / +10s
  //   , / . = frame back / frame fwd
  //   [ / ] = prev / next event
  document.addEventListener('keydown', e => {
    const videoTab = document.getElementById('video-review');
    if (!videoTab.classList.contains('active')) return;
    // Never fire shortcuts while the user is typing
    if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
    if (e.target.isContentEditable) return;

    // Film-control keys (no modifier expected for most; checked first so they
    // take priority over any accidental overlap check below)
    if (currentVideoId) {
      switch (e.key) {
        case ' ':
          e.preventDefault();
          if (player.paused()) player.play(); else player.pause();
          return;
        case 'ArrowLeft':
          e.preventDefault();
          player.currentTime(clampTime(player.currentTime() - (e.shiftKey ? 10 : 5)));
          return;
        case 'ArrowRight':
          e.preventDefault();
          player.currentTime(clampTime(player.currentTime() + (e.shiftKey ? 10 : 5)));
          return;
        case ',':
          e.preventDefault();
          player.pause();
          player.currentTime(clampTime(player.currentTime() - FRAME_SEC));
          return;
        case '.':
          e.preventDefault();
          player.pause();
          player.currentTime(clampTime(player.currentTime() + FRAME_SEC));
          return;
        case '[': {
          e.preventDefault();
          const t = player.currentTime();
          const prev = [...currentVideoEvents].reverse().find(ev => ev.timestamp < t - 0.1);
          if (prev) player.currentTime(prev.timestamp);
          return;
        }
        case ']': {
          e.preventDefault();
          const t = player.currentTime();
          const next = currentVideoEvents.find(ev => ev.timestamp > t + 0.1);
          if (next) player.currentTime(next.timestamp);
          return;
        }
      }
    }

    // Event-tagging shortcuts (1-0, Q-P) -- only when video is loaded
    if (!currentVideoId) return;
    const key = e.key.toUpperCase();
    const idx = shortcutKeys.indexOf(key);
    if (idx !== -1 && idx < eventTypes.length) {
      handleEventButtonClick(eventTypes[idx].id);
      const btn = document.querySelector(`.event-btn[data-id="${eventTypes[idx].id}"]`);
      if (btn) {
        btn.classList.add('active');
        setTimeout(() => btn.classList.remove('active'), 200);
      }
    }
  });

  // Click on event -> seek to timestamp
  eventsListEl.addEventListener('click', e => {
    const item = e.target.closest('.event-item');
    if (!item || e.target.classList.contains('event-edit-btn')) return;
    player.currentTime(parseFloat(item.dataset.timestamp));
    player.play();
  });

  // Click on player event -> switch to video tab and seek
  playerEventsEl.addEventListener('click', async e => {
    const item = e.target.closest('.player-event-item');
    if (!item) return;

    const videoId   = parseInt(item.dataset.videoId, 10);
    const timestamp = parseFloat(item.dataset.timestamp);
    const filePath  = item.dataset.filePath;
    const displayName = item.dataset.displayName;

    tabButtons[0].click(); // switch to Video Review tab

    openVideo(videoId, filePath, displayName, {
      game_date: item.dataset.gameDate || null,
      competition_id: item.dataset.competitionId ? parseInt(item.dataset.competitionId, 10) : null,
      competition_name: item.dataset.competitionName || null,
    });
    player.one('loadedmetadata', () => {
      player.currentTime(timestamp);
      loadVideoEvents(videoId);
    });
  });

  // -------------------------------------------------------------------------
  // Custom event type
  // -------------------------------------------------------------------------
  addCustomEventBtn.addEventListener('click', () => {
    showModal('Add Custom Event Type', 'Event type name', async name => {
      const result = await api.addEventType(name, true);
      eventTypes.push(result);
      loadEventTypes();
    });
  });

  // -------------------------------------------------------------------------
  // Players
  // -------------------------------------------------------------------------
  function addPlayerFlow() {
    showModal('Add Player', 'Player name', async name => {
      const result = await api.addPlayer(name);
      players.push(result);
      loadPlayers();
    });
  }
  addPlayerBtn.addEventListener('click', addPlayerFlow);
  addPlayerProfileBtn.addEventListener('click', addPlayerFlow);

  // -------------------------------------------------------------------------
  // Event edit modal
  // -------------------------------------------------------------------------
  async function openEventEditModal(eventId) {
    try {
      const event = await api.getEvent(eventId);
      currentEditEventId = eventId;

      editEventTypeEl.textContent    = event.event_type_name;
      editEventTimestamp.textContent = formatTime(event.timestamp);

      editPlayerSelection.innerHTML = '';
      players.forEach(p => {
        const container = document.createElement('div');
        container.className = 'player-checkbox';

        const cb = document.createElement('input');
        cb.type    = 'checkbox';
        cb.id      = `edit-player-${p.id}`;
        cb.value   = p.id;
        cb.checked = event.players.some(ep => ep.id === p.id);

        const label = document.createElement('label');
        label.htmlFor    = `edit-player-${p.id}`;
        label.textContent = p.name;

        container.appendChild(cb);
        container.appendChild(label);
        editPlayerSelection.appendChild(container);
      });

      eventEditModal.style.display = 'block';
    } catch (err) {
      console.error('Error loading event details:', err);
      alert('Failed to load event details: ' + err.message);
    }
  }

  eventEditSaveBtn.addEventListener('click', async () => {
    if (!currentEditEventId) return;
    const playerIds = Array.from(
      editPlayerSelection.querySelectorAll('input[type="checkbox"]:checked')
    ).map(cb => parseInt(cb.value, 10));

    await api.updateEventPlayers(currentEditEventId, playerIds);
    loadVideoEvents(currentVideoId);
    eventEditModal.style.display = 'none';
  });

  eventDeleteBtn.addEventListener('click', async () => {
    if (!currentEditEventId) return;
    if (!confirm('Delete this event?')) return;
    await api.deleteEvent(currentEditEventId);
    loadVideoEvents(currentVideoId);
    eventEditModal.style.display = 'none';
  });

  // -------------------------------------------------------------------------
  // Generic modal
  // -------------------------------------------------------------------------
  function showModal(title, placeholder, callback) {
    modalTitle.textContent   = title;
    modalInput.placeholder   = placeholder;
    modalInput.value         = '';
    modal.style.display      = 'block';
    modalInput.focus();

    const handler = async () => {
      const value = modalInput.value.trim();
      if (!value) { alert('Please enter a value'); return; }
      try {
        await callback(value);
        modal.style.display = 'none';
      } catch (err) {
        alert('Error: ' + err.message);
      }
      modalSaveBtn.removeEventListener('click', handler);
    };

    modalSaveBtn.removeEventListener('click', handler);
    modalSaveBtn.addEventListener('click', handler);
  }

  // -------------------------------------------------------------------------
  // Data loaders
  // -------------------------------------------------------------------------
  async function loadEventTypes() {
    try {
      eventTypes = await api.getEventTypes();
      eventTypeButtons.innerHTML = '';

      eventTypes.forEach((et, idx) => {
        const btn = document.createElement('button');
        btn.className  = `event-btn ${et.is_custom ? 'custom' : ''}`;
        btn.dataset.id = et.id;

        const nameSpan = document.createElement('span');
        nameSpan.className   = 'name';
        nameSpan.textContent = et.name;

        const shortSpan = document.createElement('span');
        shortSpan.className = 'shortcut';
        if (idx < shortcutKeys.length) {
          shortSpan.textContent = `[${shortcutKeys[idx]}]`;
          btn.title = `Press ${shortcutKeys[idx]} to tag (${et.name})`;
        }

        btn.appendChild(nameSpan);
        btn.appendChild(shortSpan);
        btn.addEventListener('click', () => handleEventButtonClick(et.id));
        eventTypeButtons.appendChild(btn);
      });

      const help = document.createElement('div');
      help.className   = 'keyboard-shortcuts';
      help.innerHTML   = '<h4>Keyboard Shortcuts</h4><p>Press the bracketed key to tag an event at the current time.</p>';
      eventTypeButtons.appendChild(help);

    } catch (err) {
      console.error('Error loading event types:', err);
      alert('Failed to load event types: ' + err.message);
    }
  }

  async function loadPlayers() {
    try {
      players = await api.getPlayers();
      updatePlayerSelection();
      updatePlayerList();
    } catch (err) {
      console.error('Error loading players:', err);
    }
  }

  function updatePlayerSelection() {
    playerSelectionEl.innerHTML = '';
    players.forEach(p => {
      const container = document.createElement('div');
      container.className = 'player-checkbox';

      const cb = document.createElement('input');
      cb.type  = 'checkbox';
      cb.id    = `player-${p.id}`;
      cb.value = p.id;

      const label = document.createElement('label');
      label.htmlFor    = `player-${p.id}`;
      label.textContent = p.name;

      container.appendChild(cb);
      container.appendChild(label);
      playerSelectionEl.appendChild(container);
    });
  }

  function updatePlayerList() {
    playerListEl.innerHTML = '';
    players.forEach(p => {
      const li = document.createElement('li');
      li.className = 'player-item';
      li.dataset.id = p.id;

      const nameSpan = document.createElement('span');
      nameSpan.textContent = p.name;

      const actions = document.createElement('div');
      actions.className = 'player-actions';

      const editBtn = document.createElement('button');
      editBtn.className   = 'btn btn-small';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', e => {
        e.stopPropagation();
        showModal('Edit Player', 'Player name', async name => {
          await api.updatePlayer(p.id, name);
          loadPlayers();
        });
        modalInput.value = p.name;
      });

      const delBtn = document.createElement('button');
      delBtn.className   = 'btn btn-small btn-danger';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', async e => {
        e.stopPropagation();
        if (!confirm(`Delete ${p.name}? This also removes their event associations.`)) return;
        await api.deletePlayer(p.id);
        if (selectedPlayerId === p.id) {
          selectedPlayerId = null;
          selectedPlayerName.textContent = 'Select a Player';
          playerEventsEl.innerHTML = '';
        }
        loadPlayers();
      });

      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      li.appendChild(nameSpan);
      li.appendChild(actions);

      li.addEventListener('click', () => {
        selectedPlayerId = p.id;
        selectedPlayerName.textContent = p.name;
        loadPlayerEvents(p.id);
      });

      playerListEl.appendChild(li);
    });
  }

  async function loadVideoEvents(videoId) {
    if (!videoId) return;
    try {
      const events = await api.getVideoEvents(videoId);
      updateEventsList(events);

      if (player.annotationComments) {
        player.annotationComments().clearAll();
        events.forEach(ev => {
          const names = ev.players.map(p => p.name).join(', ');
          player.annotationComments().addAnnotation({
            id: ev.id,
            range: { start: ev.timestamp, end: ev.timestamp + 0.5 },
            commentStr: `${ev.event_type_name}${names ? ': ' + names : ''}`,
            meta: { datetime: new Date().toISOString(), user_id: 1, user_name: 'Coach' },
          });
        });
      }
    } catch (err) {
      console.error('Error loading video events:', err);
      alert('Failed to load video events: ' + err.message);
    }
  }

  function updateEventsList(events) {
    // Keep a sorted copy for prev/next event navigation
    currentVideoEvents = [...events].sort((a, b) => a.timestamp - b.timestamp);
    eventsListEl.innerHTML = '';
    events.forEach(ev => {
      const div = document.createElement('div');
      div.className        = 'event-item';
      div.dataset.id        = ev.id;
      div.dataset.timestamp = ev.timestamp;

      const tsSpan = document.createElement('span');
      tsSpan.className   = 'event-timestamp';
      tsSpan.textContent = formatTime(ev.timestamp);

      const typeSpan = document.createElement('span');
      typeSpan.className   = 'event-type';
      typeSpan.textContent = ev.event_type_name;

      const playersSpan = document.createElement('span');
      playersSpan.className   = 'event-players';
      playersSpan.textContent = ev.players.map(p => p.name).join(', ');

      const editBtn = document.createElement('button');
      editBtn.className   = 'event-edit-btn';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', e => {
        e.stopPropagation();
        openEventEditModal(ev.id);
      });

      div.appendChild(tsSpan);
      div.appendChild(typeSpan);
      div.appendChild(playersSpan);
      div.appendChild(editBtn);
      eventsListEl.appendChild(div);
    });
  }

  async function loadPlayerEvents(playerId) {
    if (!playerId) return;
    try {
      const events = await api.getPlayerEvents(playerId);
      playerEventsEl.innerHTML = '';

      if (events.length === 0) {
        const empty = document.createElement('div');
        empty.className   = 'empty-message';
        empty.textContent = 'No events found for this player';
        playerEventsEl.appendChild(empty);
        return;
      }

      let lastVideoId = null;
      let container   = null;

      events.forEach(ev => {
        if (ev.video_id !== lastVideoId) {
          lastVideoId = ev.video_id;
          container = document.createElement('div');
          container.className = 'player-event-video-container';

          const title = document.createElement('h3');
          title.className   = 'player-event-video';
          const datePart = ev.game_date ? ` (${ev.game_date})` : '';
          const compPart = ev.competition_name ? ` -- ${ev.competition_name}` : '';
          title.textContent = ev.file_path.replace(/^\d+_/, '') + datePart + compPart;
          container.appendChild(title);
          playerEventsEl.appendChild(container);
        }

        const item = document.createElement('div');
        item.className              = 'player-event-item';
        item.dataset.videoId        = ev.video_id;
        item.dataset.timestamp      = ev.timestamp;
        item.dataset.filePath       = ev.file_path;
        item.dataset.displayName    = ev.file_path.replace(/^\d+_/, '');
        item.dataset.gameDate       = ev.game_date || '';
        item.dataset.competitionId  = ev.competition_id || '';
        item.dataset.competitionName = ev.competition_name || '';

        const details = document.createElement('div');
        details.className = 'player-event-details';

        const tsSpan = document.createElement('span');
        tsSpan.className   = 'event-timestamp';
        tsSpan.textContent = formatTime(ev.timestamp);

        const typeSpan = document.createElement('span');
        typeSpan.className   = 'event-type';
        typeSpan.textContent = ev.event_type_name;

        details.appendChild(tsSpan);
        details.appendChild(typeSpan);
        item.appendChild(details);
        container.appendChild(item);
      });
    } catch (err) {
      console.error('Error loading player events:', err);
      alert('Failed to load player events: ' + err.message);
    }
  }

  // -------------------------------------------------------------------------
  // Utilities
  // -------------------------------------------------------------------------
  function formatTime(secs) {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
});
