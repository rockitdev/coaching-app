// renderer.js — Hockey Coach App

document.addEventListener('DOMContentLoaded', () => {
  // ─── Video.js player ───────────────────────────────────────────────────────
  const player = videojs('hockey-video', {
    controls: true,
    autoplay: false,
    preload: 'auto',
    fluid: true
  });

  // Legacy annotation plugin (kept for existing non-shot events; wrapped defensively)
  let annotationComments;
  try {
    if (typeof videojs.annotationComments === 'function') {
      annotationComments = videojs.annotationComments(player, {
        annotationsObjects: [],
        meta: { user_id: 1, user_name: 'Coach' }
      });
      player.annotationComments = () => ({
        addAnnotation: (annotation) => {
          annotationComments.add({
            range: {
              start: annotation.range.start,
              end: annotation.range.end || annotation.range.start + 0.5
            },
            text: annotation.commentStr,
            meta: annotation.meta
          });
        },
        clearAll: () => annotationComments.removeAll()
      });
    } else {
      console.warn('VideoJS Annotation Comments plugin not available');
    }
  } catch (error) {
    console.error('Error initializing annotation system:', error);
  }

  // ─── DOM elements ──────────────────────────────────────────────────────────
  const tabButtons               = document.querySelectorAll('.tab-button');
  const tabContents              = document.querySelectorAll('.tab-content');
  const loadVideoBtn             = document.getElementById('load-video-btn');
  const videoInfo                = document.getElementById('video-info');
  const eventTypeButtons         = document.getElementById('event-type-buttons');
  const playerSelection          = document.getElementById('player-selection');
  const addCustomEventBtn        = document.getElementById('add-custom-event-btn');
  const eventsList               = document.getElementById('events-list');
  const playerList               = document.getElementById('player-list');
  const playerEvents             = document.getElementById('player-events');
  const selectedPlayerName       = document.getElementById('selected-player-name');
  const addPlayerBtn             = document.getElementById('add-player-btn');
  const modal                    = document.getElementById('modal');
  const modalTitle               = document.getElementById('modal-title');
  const modalInput               = document.getElementById('modal-input');
  const modalSaveBtn             = document.getElementById('modal-save-btn');
  const modalClose               = document.querySelector('#modal .close');

  // Goalie-line elements
  const goalieLineEl  = document.getElementById('goalie-line');
  const glShots       = document.getElementById('gl-shots');
  const glSaves       = document.getElementById('gl-saves');
  const glSvPct       = document.getElementById('gl-svpct');
  const glGa          = document.getElementById('gl-ga');

  // Shot-against panel elements
  const resultPicker       = document.getElementById('result-picker');
  const stagedTimeEl       = document.getElementById('staged-time');
  const opponentNetToggle  = document.getElementById('opponent-net-toggle');
  const shotsOnlyToggle    = document.getElementById('shots-only-toggle');
  const shotMarkersContainer = document.getElementById('shot-markers-container');

  // Shot-nav buttons
  const prevShotBtn = document.getElementById('prev-shot-btn');
  const nextShotBtn = document.getElementById('next-shot-btn');

  // Event edit modal elements
  const eventEditModal      = document.getElementById('event-edit-modal');
  const editEventType       = document.getElementById('edit-event-type');
  const editEventTimestamp  = document.getElementById('edit-event-timestamp');
  const editShotResultRow   = document.getElementById('edit-shot-result-row');
  const editShotResult      = document.getElementById('edit-shot-result');
  const editPlayerSelection = document.getElementById('edit-player-selection');
  const eventEditSaveBtn    = document.getElementById('event-edit-save-btn');
  const eventDeleteBtn      = document.getElementById('event-delete-btn');
  const eventEditClose      = eventEditModal.querySelector('.close');

  // ─── App state ─────────────────────────────────────────────────────────────
  let currentVideoId      = null;
  let currentVideo        = null;
  let players             = [];
  let eventTypes          = [];
  let selectedPlayerId    = null;
  let selectedEventTypeId = null;
  let currentEditEventId  = null;

  // All events for the current video (kept in memory for filtering + markers)
  let allVideoEvents = [];

  // Shot-against staging: when S is pressed we capture the timestamp and wait
  // for the user to pick a result keystroke before committing to the DB.
  let stagedShot = null; // { timestamp, net }

  // Keyboard shortcut mappings (for legacy event-type buttons)
  const shortcutKeys = [
    '1', '2', '3', '4', '5', '6', '7', '8', '9', '0',
    'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'
  ];

  // ─── Tab navigation ────────────────────────────────────────────────────────
  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      tabButtons.forEach(btn => btn.classList.remove('active'));
      tabContents.forEach(content => content.classList.remove('active'));
      button.classList.add('active');
      const tabId = button.dataset.tab;
      document.getElementById(tabId).classList.add('active');
    });
  });

  // ─── Load initial data ─────────────────────────────────────────────────────
  loadEventTypes();
  loadPlayers();

  // ─── Load video ────────────────────────────────────────────────────────────
  loadVideoBtn.addEventListener('click', async () => {
    try {
      const filePath = await window.api.openFileDialog();
      if (filePath) {
        const videoResult = await window.api.addVideo(filePath);
        currentVideoId = videoResult.id;
        currentVideo   = videoResult;

        const fileName = filePath.split(/[\\/]/).pop();
        videoInfo.textContent = `Current video: ${fileName}`;

        player.src({ src: filePath, type: 'video/mp4' });

        // Once the duration is known we can position markers correctly
        player.one('loadedmetadata', () => {
          loadVideoEvents(currentVideoId);
        });
      }
    } catch (error) {
      console.error('Error loading video:', error);
      alert('Failed to load video: ' + error.message);
    }
  });

  // ─── Generic event tagging (legacy event-type buttons) ────────────────────
  async function tagEvent(eventTypeId, net, result) {
    if (!currentVideoId) {
      alert('Please load a video first');
      return;
    }
    if (isNaN(eventTypeId)) {
      alert('Please select an event type');
      return;
    }

    const timestamp = player.currentTime();

    try {
      const eventResult = await window.api.addEvent(
        currentVideoId, eventTypeId, timestamp,
        net  || undefined,
        result || undefined
      );

      const selectedPlayers = Array.from(
        document.querySelectorAll('.player-checkbox input:checked')
      ).map(checkbox => parseInt(checkbox.value));

      if (selectedPlayers.length > 0) {
        for (const playerId of selectedPlayers) {
          await window.api.addEventPlayerAssociation(eventResult.id, playerId);
        }
      }

      // Legacy annotation (for non-shot events)
      if (!net && player.annotationComments) {
        const eventType   = eventTypes.find(et => et.id === eventTypeId);
        const playerNames = selectedPlayers.map(pid => {
          const p = players.find(pl => pl.id === pid);
          return p ? p.name : '';
        }).join(', ');

        player.annotationComments().addAnnotation({
          id: eventResult.id,
          range: { start: timestamp, end: timestamp + 0.5 },
          commentStr: `${eventType.name}${playerNames ? ': ' + playerNames : ''}`,
          meta: { datetime: new Date().toISOString(), user_id: 1, user_name: 'Coach' }
        });
      }

      await loadVideoEvents(currentVideoId);
    } catch (error) {
      console.error('Error tagging event:', error);
      alert('Failed to tag event: ' + error.message);
    }
  }

  function handleEventButtonClick(eventTypeId) {
    selectedEventTypeId = eventTypeId;
    document.querySelectorAll('.event-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.id) === eventTypeId);
    });
    tagEvent(eventTypeId);
  }

  // ─── Shot Against flow ──────────────────────────────────────────────────────
  // Step 1: S key → stage a shot at currentTime, show result picker
  function stageShot() {
    if (!currentVideoId) { alert('Please load a video first'); return; }
    const timestamp = player.currentTime();
    const net = opponentNetToggle.checked ? 'opponent' : 'own';

    stagedShot = { timestamp, net };

    const minutes = Math.floor(timestamp / 60);
    const seconds  = Math.floor(timestamp % 60);
    stagedTimeEl.textContent =
      `${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')} (${net === 'own' ? 'own net' : 'opponent net'})`;

    resultPicker.style.display = '';
    // Keep the video paused so the user can see where they are
    // (don't force-pause — the user controls playback)
  }

  // Step 2: pick a result
  async function commitShot(result) {
    if (!stagedShot) return;
    const { timestamp, net } = stagedShot;
    stagedShot = null;
    resultPicker.style.display = 'none';

    // Find the "Shot Against" event type id — fall back to creating one
    let shotTypeId = getShotAgainstTypeId();
    if (!shotTypeId) {
      try {
        const newType = await window.api.addEventType('Shot Against', false);
        eventTypes.push(newType);
        shotTypeId = newType.id;
        loadEventTypes(); // refresh button list
      } catch (err) {
        console.error('Could not create Shot Against type:', err);
        alert('Failed to create Shot Against event type');
        return;
      }
    }

    try {
      await window.api.addEvent(currentVideoId, shotTypeId, timestamp, net, result);
      await loadVideoEvents(currentVideoId);
    } catch (err) {
      console.error('Error committing shot:', err);
      alert('Failed to save shot: ' + err.message);
    }
  }

  function cancelStagedShot() {
    stagedShot = null;
    resultPicker.style.display = 'none';
  }

  function getShotAgainstTypeId() {
    const et = eventTypes.find(t =>
      t.name.toLowerCase() === 'shot against' ||
      t.name.toLowerCase() === 'shot-against'
    );
    return et ? et.id : null;
  }

  // Result picker button clicks
  resultPicker.addEventListener('click', async (e) => {
    const btn = e.target.closest('.result-btn');
    if (!btn) return;
    const result = btn.dataset.result;
    if (result === 'cancel') {
      cancelStagedShot();
    } else {
      await commitShot(result);
    }
  });

  // ─── Keyboard shortcuts ────────────────────────────────────────────────────
  document.addEventListener('keydown', async (e) => {
    const videoTab = document.getElementById('video-review');
    if (!videoTab.classList.contains('active')) return;

    // Never fire shortcuts when typing in an input/modal
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    const key = e.key.toUpperCase();

    // ── Shot-against result picker shortcuts (active while shot is staged) ──
    if (stagedShot) {
      const resultMap = { 'A': 'save', 'D': 'goal', 'F': 'miss', 'G': 'rebound' };
      if (key === 'ESCAPE') { cancelStagedShot(); return; }
      if (resultMap[key]) { await commitShot(resultMap[key]); return; }
      return; // eat other keys while staged
    }

    // ── S → stage a shot against ─────────────────────────────────────────
    if (key === 'S' && currentVideoId) {
      stageShot();
      return;
    }

    // ── J/K → prev/next shot ─────────────────────────────────────────────
    if (key === 'J' && currentVideoId) { jumpShot('prev'); return; }
    if (key === 'K' && currentVideoId) { jumpShot('next'); return; }

    // ── Legacy event-type shortcuts ───────────────────────────────────────
    if (!currentVideoId) return;
    const shortcutIndex = shortcutKeys.indexOf(key);
    if (shortcutIndex !== -1 && shortcutIndex < eventTypes.length) {
      const eventTypeId = eventTypes[shortcutIndex].id;
      handleEventButtonClick(eventTypeId);
      const button = document.querySelector(`.event-btn[data-id="${eventTypeId}"]`);
      if (button) {
        button.classList.add('active');
        setTimeout(() => button.classList.remove('active'), 200);
      }
    }
  });

  // ─── Jump to next / prev shot ──────────────────────────────────────────────
  function jumpShot(direction) {
    const shots = allVideoEvents.filter(ev => ev.net === 'own' && ev.result);
    if (shots.length === 0) return;

    const now = player.currentTime();
    let target;

    if (direction === 'next') {
      target = shots.find(s => s.timestamp > now + 0.1);
      if (!target) target = shots[0]; // wrap
    } else {
      const earlier = shots.filter(s => s.timestamp < now - 0.1);
      target = earlier.length ? earlier[earlier.length - 1] : shots[shots.length - 1]; // wrap
    }

    if (target) {
      player.currentTime(target.timestamp);
    }
  }

  prevShotBtn.addEventListener('click', () => jumpShot('prev'));
  nextShotBtn.addEventListener('click', () => jumpShot('next'));

  // ─── Events list click → seek ──────────────────────────────────────────────
  eventsList.addEventListener('click', e => {
    const eventItem = e.target.closest('.event-item');
    if (eventItem && !e.target.closest('.event-edit-btn')) {
      const timestamp = parseFloat(eventItem.dataset.timestamp);
      player.currentTime(timestamp);
      player.play();
    }
  });

  // ─── Player event click ────────────────────────────────────────────────────
  playerEvents.addEventListener('click', async e => {
    const eventItem = e.target.closest('.player-event-item');
    if (!eventItem) return;

    const videoId  = parseInt(eventItem.dataset.videoId);
    const timestamp = parseFloat(eventItem.dataset.timestamp);

    try {
      const videos = await window.api.getVideos();
      const video  = videos.find(v => v.id === videoId);

      if (video) {
        tabButtons[0].click();
        currentVideoId = videoId;
        currentVideo   = video;
        const fileName = video.file_path.split(/[\\/]/).pop();
        videoInfo.textContent = `Current video: ${fileName}`;
        player.src({ src: video.file_path, type: 'video/mp4' });
        player.one('loadedmetadata', () => {
          player.currentTime(timestamp);
          loadVideoEvents(videoId);
        });
      }
    } catch (error) {
      console.error('Error loading player event video:', error);
      alert('Failed to load video: ' + error.message);
    }
  });

  // ─── Custom event / player add ─────────────────────────────────────────────
  addCustomEventBtn.addEventListener('click', () => {
    showModal('Add Custom Event Type', 'Enter event type name:', async name => {
      if (!name) return;
      try {
        const result = await window.api.addEventType(name, true);
        eventTypes.push(result);
        loadEventTypes();
      } catch (error) {
        console.error('Error adding custom event type:', error);
        alert('Failed to add custom event type: ' + error.message);
      }
    });
  });

  addPlayerBtn.addEventListener('click', () => {
    showModal('Add Player', 'Enter player name:', async name => {
      if (!name) return;
      try {
        const result = await window.api.addPlayer(name);
        players.push(result);
        loadPlayers();
      } catch (error) {
        console.error('Error adding player:', error);
        alert('Failed to add player: ' + error.message);
      }
    });
  });

  // ─── Shots-only filter toggle ──────────────────────────────────────────────
  shotsOnlyToggle.addEventListener('change', () => {
    renderEventsList(allVideoEvents);
  });

  // ─── Modal helpers ─────────────────────────────────────────────────────────
  modalClose.addEventListener('click', () => { modal.style.display = 'none'; });
  window.addEventListener('click', e => {
    if (e.target === modal) modal.style.display = 'none';
    if (e.target === eventEditModal) eventEditModal.style.display = 'none';
  });

  function showModal(title, placeholder, callback) {
    modalTitle.textContent  = title;
    modalInput.placeholder  = placeholder;
    modalInput.value        = '';
    modal.style.display     = 'block';
    modalInput.focus();

    modalSaveBtn.removeEventListener('click', modalSaveHandler);
    modalSaveBtn.addEventListener('click', modalSaveHandler);

    function modalSaveHandler() {
      const value = modalInput.value.trim();
      if (value) {
        callback(value);
        modal.style.display = 'none';
      } else {
        alert('Please enter a valid name');
      }
    }
  }

  // ─── Load event types ──────────────────────────────────────────────────────
  async function loadEventTypes() {
    try {
      eventTypes = await window.api.getEventTypes();
      eventTypeButtons.innerHTML = '';

      eventTypes.forEach((eventType, index) => {
        const button = document.createElement('button');
        button.className = `event-btn ${eventType.is_custom ? 'custom' : ''}`;
        button.dataset.id = eventType.id;

        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = eventType.name;

        const shortcut = document.createElement('span');
        shortcut.className = 'shortcut';
        if (index < shortcutKeys.length) {
          shortcut.textContent = `[${shortcutKeys[index]}]`;
          button.title = `Press ${shortcutKeys[index]} to tag (${eventType.name})`;
        }

        button.appendChild(name);
        button.appendChild(shortcut);
        button.addEventListener('click', () => handleEventButtonClick(eventType.id));
        eventTypeButtons.appendChild(button);
      });

      const helpDiv = document.createElement('div');
      helpDiv.className = 'keyboard-shortcuts';
      helpDiv.innerHTML = `
        <h4>Keyboard Shortcuts</h4>
        <p>Numbers/letters in brackets tag that event type.<br>
        <strong>[S]</strong> = tag Shot Against · then <strong>[A]</strong>ave / <strong>[D]</strong>oal / <strong>[F]</strong>iss / <strong>[G]</strong>ebound<br>
        <strong>[J]</strong> = prev shot · <strong>[K]</strong> = next shot</p>
      `;
      eventTypeButtons.appendChild(helpDiv);
    } catch (error) {
      console.error('Error loading event types:', error);
      alert('Failed to load event types: ' + error.message);
    }
  }

  // ─── Load players ──────────────────────────────────────────────────────────
  async function loadPlayers() {
    try {
      players = await window.api.getPlayers();
      updatePlayerSelection();
      updatePlayerList();
    } catch (error) {
      console.error('Error loading players:', error);
      alert('Failed to load players: ' + error.message);
    }
  }

  function updatePlayerSelection() {
    playerSelection.innerHTML = '';
    players.forEach(p => {
      const container = document.createElement('div');
      container.className = 'player-checkbox';

      const checkbox = document.createElement('input');
      checkbox.type  = 'checkbox';
      checkbox.id    = `player-${p.id}`;
      checkbox.value = p.id;

      const label    = document.createElement('label');
      label.htmlFor  = `player-${p.id}`;
      label.textContent = p.name;

      container.appendChild(checkbox);
      container.appendChild(label);
      playerSelection.appendChild(container);
    });
  }

  function updatePlayerList() {
    playerList.innerHTML = '';
    players.forEach(p => {
      const li = document.createElement('li');
      li.className  = 'player-item';
      li.dataset.id = p.id;

      const nameSpan = document.createElement('span');
      nameSpan.textContent = p.name + (p.is_my_goalie ? ' 🥅' : '');

      const actions = document.createElement('div');
      actions.className = 'player-actions';

      const editBtn = document.createElement('button');
      editBtn.className   = 'btn btn-small';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', e => {
        e.stopPropagation();
        showModal('Edit Player', 'Enter player name:', async name => {
          if (!name) return;
          try {
            await window.api.updatePlayer(p.id, name);
            loadPlayers();
          } catch (error) {
            console.error('Error updating player:', error);
          }
        });
        modalInput.value = p.name;
      });

      const goalieBtn = document.createElement('button');
      goalieBtn.className   = 'btn btn-small' + (p.is_my_goalie ? ' active' : '');
      goalieBtn.textContent = p.is_my_goalie ? 'My Goalie ✓' : 'Set as Goalie';
      goalieBtn.title = 'Mark this player as "my goalie" for the stat rollup';
      goalieBtn.addEventListener('click', async e => {
        e.stopPropagation();
        try {
          await window.api.setMyGoalie(p.is_my_goalie ? null : p.id);
          loadPlayers();
        } catch (error) {
          console.error('Error setting goalie:', error);
        }
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.className   = 'btn btn-small btn-danger';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', async e => {
        e.stopPropagation();
        if (confirm(`Are you sure you want to delete ${p.name}?`)) {
          try {
            await window.api.deletePlayer(p.id);
            if (selectedPlayerId === p.id) {
              selectedPlayerId = null;
              selectedPlayerName.textContent = 'Select a Player';
              playerEvents.innerHTML = '';
            }
            loadPlayers();
          } catch (error) {
            console.error('Error deleting player:', error);
          }
        }
      });

      actions.appendChild(editBtn);
      actions.appendChild(goalieBtn);
      actions.appendChild(deleteBtn);
      li.appendChild(nameSpan);
      li.appendChild(actions);
      li.addEventListener('click', () => {
        selectedPlayerId = p.id;
        selectedPlayerName.textContent = p.name;
        loadPlayerEvents(p.id);
      });
      playerList.appendChild(li);
    });
  }

  // ─── Load video events (full reload) ──────────────────────────────────────
  async function loadVideoEvents(videoId) {
    if (!videoId) return;
    try {
      allVideoEvents = await window.api.getVideoEvents(videoId);

      renderEventsList(allVideoEvents);
      renderShotMarkers(allVideoEvents);
      refreshGoalieLine(videoId);

      // Legacy annotation-comments (non-shot events only)
      if (player.annotationComments) {
        player.annotationComments().clearAll();
        allVideoEvents
          .filter(ev => !ev.net) // skip shot-against events
          .forEach(ev => {
            const playerNames = ev.players.map(p => p.name).join(', ');
            player.annotationComments().addAnnotation({
              id: ev.id,
              range: { start: ev.timestamp, end: ev.timestamp + 0.5 },
              commentStr: `${ev.event_type_name}: ${playerNames}`,
              meta: { datetime: new Date().toISOString(), user_id: 1, user_name: 'Coach' }
            });
          });
      }
    } catch (error) {
      console.error('Error loading video events:', error);
    }
  }

  // ─── Render events list (with optional shots-only filter) ─────────────────
  function renderEventsList(events) {
    eventsList.innerHTML = '';

    const shotsOnly = shotsOnlyToggle.checked;
    const filtered  = shotsOnly
      ? events.filter(ev => ev.net === 'own' && ev.result)
      : events;

    filtered.forEach(ev => {
      const div = document.createElement('div');
      div.className = 'event-item';
      div.dataset.id        = ev.id;
      div.dataset.timestamp = ev.timestamp;

      const minutes = Math.floor(ev.timestamp / 60);
      const seconds  = Math.floor(ev.timestamp % 60);
      const fmtTime  = `${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;

      const tsSpan = document.createElement('span');
      tsSpan.className   = 'event-timestamp';
      tsSpan.textContent = fmtTime;

      const typeSpan = document.createElement('span');
      typeSpan.className   = 'event-type';
      typeSpan.textContent = ev.event_type_name;

      const playersSpan = document.createElement('span');
      playersSpan.className   = 'event-players';
      playersSpan.textContent = ev.players.map(p => p.name).join(', ');

      div.appendChild(tsSpan);
      div.appendChild(typeSpan);
      div.appendChild(playersSpan);

      // Show result badge for shot-against events
      if (ev.net === 'own' && ev.result) {
        const badge = document.createElement('span');
        badge.className = `shot-result-badge result-${ev.result}`;
        badge.textContent = ev.result.toUpperCase();
        div.appendChild(badge);
      }

      const editBtn = document.createElement('button');
      editBtn.className   = 'event-edit-btn';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openEventEditModal(ev.id);
      });
      div.appendChild(editBtn);

      eventsList.appendChild(div);
    });
  }

  // ─── Shot markers on the scrub bar ────────────────────────────────────────
  // The markers are rendered as absolutely-positioned divs over the progress-bar
  // area. We wait until the player's duration is known.
  function renderShotMarkers(events) {
    shotMarkersContainer.innerHTML = '';

    const duration = player.duration();
    if (!duration || isNaN(duration) || duration <= 0) return;

    const shots = events.filter(ev => ev.net === 'own' && ev.result);

    shots.forEach(shot => {
      const pct = (shot.timestamp / duration) * 100;

      const marker = document.createElement('div');
      marker.className    = `shot-marker marker-${shot.result}`;
      marker.style.left   = `${pct}%`;
      marker.title        = `${shot.result.toUpperCase()} @ ${fmtTimestamp(shot.timestamp)}`;
      marker.dataset.eventId = shot.id;

      marker.addEventListener('click', () => {
        player.currentTime(shot.timestamp);
        player.play();
      });

      shotMarkersContainer.appendChild(marker);
    });
  }

  // Re-render markers when duration becomes available (after src change)
  player.on('loadedmetadata', () => {
    renderShotMarkers(allVideoEvents);
  });

  // ─── Goalie line panel ────────────────────────────────────────────────────
  async function refreshGoalieLine(videoId) {
    try {
      const line = await window.api.getGoalieLine(videoId);
      goalieLineEl.style.display = '';
      glShots.textContent = `SA: ${line.shots_against}`;
      glSaves.textContent = `SV: ${line.saves}`;
      glGa.textContent    = `GA: ${line.goals_against}`;
      if (line.save_pct !== null) {
        glSvPct.textContent = `SV%: ${(line.save_pct * 100).toFixed(1)}%`;
      } else {
        glSvPct.textContent = 'SV%: —';
      }
    } catch (err) {
      console.error('Error refreshing goalie line:', err);
    }
  }

  // ─── Event edit modal ─────────────────────────────────────────────────────
  async function openEventEditModal(eventId) {
    try {
      const ev = await window.api.getEvent(eventId);
      currentEditEventId = eventId;

      editEventType.textContent     = ev.event_type_name;
      editEventTimestamp.textContent = fmtTimestamp(ev.timestamp);

      if (ev.result) {
        editShotResultRow.style.display = '';
        editShotResult.textContent      = `${ev.result} (${ev.net || 'own'} net)`;
      } else {
        editShotResultRow.style.display = 'none';
      }

      editPlayerSelection.innerHTML = '';
      players.forEach(p => {
        const container = document.createElement('div');
        container.className = 'player-checkbox';

        const checkbox  = document.createElement('input');
        checkbox.type   = 'checkbox';
        checkbox.id     = `edit-player-${p.id}`;
        checkbox.value  = p.id;
        checkbox.checked = ev.players.some(ep => ep.id === p.id);

        const label   = document.createElement('label');
        label.htmlFor = `edit-player-${p.id}`;
        label.textContent = p.name;

        container.appendChild(checkbox);
        container.appendChild(label);
        editPlayerSelection.appendChild(container);
      });

      eventEditModal.style.display = 'block';
    } catch (error) {
      console.error('Error loading event details:', error);
      alert('Failed to load event details: ' + error.message);
    }
  }

  async function saveEventChanges() {
    if (!currentEditEventId) return;
    try {
      const selectedPlayerIds = Array.from(
        editPlayerSelection.querySelectorAll('input[type="checkbox"]:checked')
      ).map(cb => parseInt(cb.value));

      await window.api.updateEventPlayers(currentEditEventId, selectedPlayerIds);
      await loadVideoEvents(currentVideoId);
      eventEditModal.style.display = 'none';
    } catch (error) {
      console.error('Error updating event:', error);
      alert('Failed to update event: ' + error.message);
    }
  }

  async function deleteEvent() {
    if (!currentEditEventId) return;
    if (confirm('Are you sure you want to delete this event?')) {
      try {
        await window.api.deleteEvent(currentEditEventId);
        await loadVideoEvents(currentVideoId);
        eventEditModal.style.display = 'none';
      } catch (error) {
        console.error('Error deleting event:', error);
        alert('Failed to delete event: ' + error.message);
      }
    }
  }

  eventEditSaveBtn.addEventListener('click', saveEventChanges);
  eventDeleteBtn.addEventListener('click', deleteEvent);
  eventEditClose.addEventListener('click', () => { eventEditModal.style.display = 'none'; });

  // ─── Player events ────────────────────────────────────────────────────────
  async function loadPlayerEvents(playerId) {
    if (!playerId) return;
    try {
      const events = await window.api.getPlayerEvents(playerId);
      playerEvents.innerHTML = '';

      if (events.length === 0) {
        const emptyMessage = document.createElement('div');
        emptyMessage.className   = 'empty-message';
        emptyMessage.textContent = 'No events found for this player';
        playerEvents.appendChild(emptyMessage);
        return;
      }

      let lastVideoId      = null;
      let videoContainer   = null;

      events.forEach(ev => {
        if (ev.video_id !== lastVideoId) {
          lastVideoId = ev.video_id;
          const fileName = ev.file_path.split(/[\\/]/).pop();
          videoContainer = document.createElement('div');
          videoContainer.className = 'player-event-video-container';
          const videoTitle = document.createElement('h3');
          videoTitle.className   = 'player-event-video';
          videoTitle.textContent = fileName;
          videoContainer.appendChild(videoTitle);
          playerEvents.appendChild(videoContainer);
        }

        const eventItem = document.createElement('div');
        eventItem.className          = 'player-event-item';
        eventItem.dataset.videoId    = ev.video_id;
        eventItem.dataset.timestamp  = ev.timestamp;

        const eventDetails = document.createElement('div');
        eventDetails.className = 'player-event-details';

        const tsSpan = document.createElement('span');
        tsSpan.className   = 'event-timestamp';
        tsSpan.textContent = fmtTimestamp(ev.timestamp);

        const typeSpan = document.createElement('span');
        typeSpan.className   = 'event-type';
        typeSpan.textContent = ev.event_type_name;

        eventDetails.appendChild(tsSpan);
        eventDetails.appendChild(typeSpan);

        if (ev.result) {
          const badge = document.createElement('span');
          badge.className   = `shot-result-badge result-${ev.result}`;
          badge.textContent = ev.result.toUpperCase();
          eventDetails.appendChild(badge);
        }

        eventItem.appendChild(eventDetails);
        videoContainer.appendChild(eventItem);
      });
    } catch (error) {
      console.error('Error loading player events:', error);
    }
  }

  // ─── Utility ───────────────────────────────────────────────────────────────
  function fmtTimestamp(ts) {
    const minutes = Math.floor(ts / 60);
    const seconds  = Math.floor(ts % 60);
    return `${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
  }
});
