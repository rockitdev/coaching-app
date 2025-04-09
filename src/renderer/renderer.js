// Modified parts of renderer.js to handle event buttons and keyboard shortcuts

document.addEventListener('DOMContentLoaded', () => {
  // Initialize VideoJS player
  const player = videojs('hockey-video', {
    controls: true,
    autoplay: false,
    preload: 'auto',
    fluid: true
  });

  // Initialize annotation plugin
  let annotationComments;
  try {
    // Check if the global videojs.annotationComments function exists
    if (typeof videojs.annotationComments === 'function') {
      annotationComments = videojs.annotationComments(player, {
        annotationsObjects: [],
        meta: {
          user_id: 1,
          user_name: 'Coach'
        }
      });

      // Modify existing methods to use the new plugin
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
        clearAll: () => {
          annotationComments.removeAll();
        }
      });
    } else {
      console.warn('VideoJS Annotation Comments plugin not available');
    }
  } catch (error) {
    console.error('Error initializing annotation system:', error);
  }

  // DOM elements
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabContents = document.querySelectorAll('.tab-content');
  const loadVideoBtn = document.getElementById('load-video-btn');
  const videoInfo = document.getElementById('video-info');
  const eventTypeButtons = document.getElementById('event-type-buttons');
  const playerSelection = document.getElementById('player-selection');
  const addCustomEventBtn = document.getElementById('add-custom-event-btn');
  const eventsList = document.getElementById('events-list');
  const playerList = document.getElementById('player-list');
  const playerEvents = document.getElementById('player-events');
  const selectedPlayerName = document.getElementById('selected-player-name');
  const addPlayerBtn = document.getElementById('add-player-btn');

  // Modal elements
  const modal = document.getElementById('modal');
  const modalTitle = document.getElementById('modal-title');
  const modalInput = document.getElementById('modal-input');
  const modalSaveBtn = document.getElementById('modal-save-btn');
  const modalClose = document.querySelector('.modal .close');

  // App state
  let currentVideoId = null;
  let currentVideo = null;
  let players = [];
  let eventTypes = [];
  let selectedPlayerId = null;
  let selectedEventTypeId = null;

  // Keyboard shortcut mappings
  const shortcutKeys = [
    '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 
    'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'
  ];

  // Tab navigation
  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      // Deactivate all tabs
      tabButtons.forEach(btn => btn.classList.remove('active'));
      tabContents.forEach(content => content.classList.remove('active'));
      
      // Activate selected tab
      button.classList.add('active');
      const tabId = button.dataset.tab;
      document.getElementById(tabId).classList.add('active');
    });
  });

  // Load initial data
  loadEventTypes();
  loadPlayers();

  // Handle loading a video
  loadVideoBtn.addEventListener('click', async () => {
    try {
      console.log('video button clicked')
      const filePath = await window.api.openFileDialog();
      
      if (filePath) {
        // Add video to database
        const videoResult = await window.api.addVideo(filePath);
        currentVideoId = videoResult.id;
        currentVideo = videoResult;
        
        // Get the filename from the path
        const fileName = filePath.split(/[\\/]/).pop();
        videoInfo.textContent = `Current video: ${fileName}`;
        
        // Set the video source
        player.src({ src: filePath, type: 'video/mp4' });
        
        // Load existing events for this video
        loadVideoEvents(currentVideoId);
      }
    } catch (error) {
      console.error('Error loading video:', error);
      alert('Failed to load video: ' + error.message);
    }
  });

  // Handle tagging an event
  async function tagEvent(eventTypeId) {
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
      // Add event to database
      const eventResult = await window.api.addEvent(currentVideoId, eventTypeId, timestamp);
      
      // Get any selected players (now optional)
      const selectedPlayers = Array.from(
        document.querySelectorAll('.player-checkbox input:checked')
      ).map(checkbox => parseInt(checkbox.value));
      
      // If there are selected players, associate them with the event
      if (selectedPlayers.length > 0) {
        for (const playerId of selectedPlayers) {
          await window.api.addEventPlayerAssociation(eventResult.id, playerId);
        }
      }
      
      // Add annotation
      const eventType = eventTypes.find(et => et.id === eventTypeId);
      let playerNames = '';
      
      if (selectedPlayers.length > 0) {
        playerNames = selectedPlayers.map(playerId => {
          const player = players.find(p => p.id === playerId);
          return player ? player.name : '';
        }).join(', ');
      }
      
      if (player.annotationComments) {
        player.annotationComments().addAnnotation({
          id: eventResult.id,
          range: {
            start: timestamp,
            end: timestamp + 0.5
          },
          commentStr: `${eventType.name}${playerNames ? ': ' + playerNames : ''}`,
          meta: {
            datetime: new Date().toISOString(),
            user_id: 1,
            user_name: 'Coach'
          }
        });
      }
      
      // Reload events for this video
      loadVideoEvents(currentVideoId);
    } catch (error) {
      console.error('Error tagging event:', error);
      alert('Failed to tag event: ' + error.message);
    }
  }

  // Handle event button click
  function handleEventButtonClick(eventTypeId) {
    // Update selected event type
    selectedEventTypeId = eventTypeId;
    
    // Update UI to show active event
    const eventButtons = document.querySelectorAll('.event-btn');
    eventButtons.forEach(btn => {
      if (parseInt(btn.dataset.id) === eventTypeId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
    
    // Tag the event
    tagEvent(eventTypeId);
  }

  // Handle keyboard shortcuts
  document.addEventListener('keydown', (event) => {
    // Only process if video tab is active and a video is loaded
    const videoTab = document.getElementById('video-review');
    if (!videoTab.classList.contains('active') || !currentVideoId) {
      return;
    }
    
    // Convert key to uppercase for consistency
    const key = event.key.toUpperCase();
    
    // Find the event type that matches this shortcut
    const shortcutIndex = shortcutKeys.indexOf(key);
    if (shortcutIndex !== -1 && shortcutIndex < eventTypes.length) {
      const eventTypeId = eventTypes[shortcutIndex].id;
      handleEventButtonClick(eventTypeId);
      
      // Flash the button to provide visual feedback
      const button = document.querySelector(`.event-btn[data-id="${eventTypeId}"]`);
      if (button) {
        button.classList.add('active');
        setTimeout(() => {
          button.classList.remove('active');
        }, 200);
      }
    }
  });

  // Handle clicking on an event in the events list
  eventsList.addEventListener('click', event => {
    const eventItem = event.target.closest('.event-item');
    if (eventItem) {
      const timestamp = parseFloat(eventItem.dataset.timestamp);
      player.currentTime(timestamp);
      player.play();
    }
  });

  // Handle clicking on a player event
  playerEvents.addEventListener('click', async event => {
    const eventItem = event.target.closest('.player-event-item');
    if (!eventItem) return;
    
    const videoId = parseInt(eventItem.dataset.videoId);
    const timestamp = parseFloat(eventItem.dataset.timestamp);
    
    try {
      // Get the video file path
      const videos = await window.api.getVideos();
      const video = videos.find(v => v.id === videoId);
      
      if (video) {
        // Switch to the video review tab
        tabButtons[0].click();
        
        // Load the video
        currentVideoId = videoId;
        currentVideo = video;
        const fileName = video.file_path.split(/[\\/]/).pop();
        videoInfo.textContent = `Current video: ${fileName}`;
        
        // Set the video source
        player.src({ src: video.file_path, type: 'video/mp4' });
        
        // Wait for video to load
        player.one('loadedmetadata', () => {
          // Seek to the event timestamp
          player.currentTime(timestamp);
          
          // Load existing events for this video
          loadVideoEvents(videoId);
        });
      }
    } catch (error) {
      console.error('Error loading player event video:', error);
      alert('Failed to load video: ' + error.message);
    }
  });

  // Handle adding a custom event type
  addCustomEventBtn.addEventListener('click', () => {
    showModal('Add Custom Event Type', 'Enter event type name:', async name => {
      if (!name) return;
      
      try {
        const result = await window.api.addEventType(name, true);
        
        // Add new event type to the list
        eventTypes.push(result);
        
        // Reload event types
        loadEventTypes();
      } catch (error) {
        console.error('Error adding custom event type:', error);
        alert('Failed to add custom event type: ' + error.message);
      }
    });
  });

  // Handle adding a player
  addPlayerBtn.addEventListener('click', () => {
    showModal('Add Player', 'Enter player name:', async name => {
      if (!name) return;
      
      try {
        const result = await window.api.addPlayer(name);
        
        // Add new player to the list
        players.push(result);
        
        // Reload players
        loadPlayers();
      } catch (error) {
        console.error('Error adding player:', error);
        alert('Failed to add player: ' + error.message);
      }
    });
  });

  // Modal close button
  modalClose.addEventListener('click', () => {
    modal.style.display = 'none';
  });

  // Modal click outside
  window.addEventListener('click', event => {
    if (event.target === modal) {
      modal.style.display = 'none';
    }
  });

  // Helper function to show modal
  function showModal(title, placeholder, callback) {
    modalTitle.textContent = title;
    modalInput.placeholder = placeholder;
    modalInput.value = '';
    
    modal.style.display = 'block';
    modalInput.focus();
    
    // Remove previous event listener
    modalSaveBtn.removeEventListener('click', modalSaveHandler);
    
    // Set up new event listener
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

  // Helper function to load event types and create buttons
  async function loadEventTypes() {
    try {
      eventTypes = await window.api.getEventTypes();
      
      // Clear existing buttons
      eventTypeButtons.innerHTML = '';
      
      // Create event type buttons with keyboard shortcuts
      eventTypes.forEach((eventType, index) => {
        const button = document.createElement('button');
        button.className = `event-btn ${eventType.is_custom ? 'custom' : ''}`;
        button.dataset.id = eventType.id;
        
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = eventType.name;
        
        const shortcut = document.createElement('span');
        shortcut.className = 'shortcut';
        
        // Assign a keyboard shortcut if available
        if (index < shortcutKeys.length) {
          shortcut.textContent = `[${shortcutKeys[index]}]`;
          button.title = `Press ${shortcutKeys[index]} to tag (${eventType.name})`;
        }
        
        button.appendChild(name);
        button.appendChild(shortcut);
        
        button.addEventListener('click', () => {
          handleEventButtonClick(eventType.id);
        });
        
        eventTypeButtons.appendChild(button);
      });
      
      // Add keyboard shortcuts help
      const helpDiv = document.createElement('div');
      helpDiv.className = 'keyboard-shortcuts';
      helpDiv.innerHTML = `
        <h4>Keyboard Shortcuts</h4>
        <p>Press the key shown in brackets to quickly tag an event.</p>
      `;
      eventTypeButtons.appendChild(helpDiv);
      
    } catch (error) {
      console.error('Error loading event types:', error);
      alert('Failed to load event types: ' + error.message);
    }
  }

  // Helper function to load players
  async function loadPlayers() {
    try {
      players = await window.api.getPlayers();
      
      // Update player selection in the event tagging panel
      updatePlayerSelection();
      
      // Update player list in the player profiles tab
      updatePlayerList();
    } catch (error) {
      console.error('Error loading players:', error);
      alert('Failed to load players: ' + error.message);
    }
  }

  // Helper function to update player selection
  function updatePlayerSelection() {
    playerSelection.innerHTML = '';
    
    players.forEach(player => {
      const container = document.createElement('div');
      container.className = 'player-checkbox';
      
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = `player-${player.id}`;
      checkbox.value = player.id;
      
      const label = document.createElement('label');
      label.htmlFor = `player-${player.id}`;
      label.textContent = player.name;
      
      container.appendChild(checkbox);
      container.appendChild(label);
      playerSelection.appendChild(container);
    });
  }

  // Helper function to update player list
  function updatePlayerList() {
    playerList.innerHTML = '';
    
    players.forEach(player => {
      const li = document.createElement('li');
      li.className = 'player-item';
      li.dataset.id = player.id;
      
      const nameSpan = document.createElement('span');
      nameSpan.textContent = player.name;
      
      const actions = document.createElement('div');
      actions.className = 'player-actions';
      
      const editBtn = document.createElement('button');
      editBtn.className = 'btn btn-small';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', event => {
        event.stopPropagation();
        showModal('Edit Player', 'Enter player name:', async name => {
          if (!name) return;
          
          try {
            await window.api.updatePlayer(player.id, name);
            loadPlayers();
          } catch (error) {
            console.error('Error updating player:', error);
            alert('Failed to update player: ' + error.message);
          }
        });
        modalInput.value = player.name;
      });
      
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn btn-small btn-danger';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', async event => {
        event.stopPropagation();
        
        if (confirm(`Are you sure you want to delete ${player.name}? This will also remove all associated events.`)) {
          try {
            await window.api.deletePlayer(player.id);
            
            // Reset selected player if deleted
            if (selectedPlayerId === player.id) {
              selectedPlayerId = null;
              selectedPlayerName.textContent = 'Select a Player';
              playerEvents.innerHTML = '';
            }
            
            loadPlayers();
          } catch (error) {
            console.error('Error deleting player:', error);
            alert('Failed to delete player: ' + error.message);
          }
        }
      });
      
      actions.appendChild(editBtn);
      actions.appendChild(deleteBtn);
      
      li.appendChild(nameSpan);
      li.appendChild(actions);
      
      // Handle clicking on player name to view events
      li.addEventListener('click', () => {
        selectedPlayerId = player.id;
        selectedPlayerName.textContent = player.name;
        loadPlayerEvents(player.id);
      });
      
      playerList.appendChild(li);
    });
  }

  // Helper function to load events for a video
  async function loadVideoEvents(videoId) {
    if (!videoId) return;
    
    try {
      const events = await window.api.getVideoEvents(videoId);
      
      // Update events list
      updateEventsList(events);
      
      // Clear existing annotations
      if (player.annotationComments) {
        player.annotationComments().clearAll();
      }
      
      // Add annotations for each event
      events.forEach(event => {
        const playerNames = event.players.map(p => p.name).join(', ');
        
        if (player.annotationComments) {
          player.annotationComments().addAnnotation({
            id: event.id,
            range: {
              start: event.timestamp,
              end: event.timestamp + 0.5
            },
            commentStr: `${event.event_type_name}: ${playerNames}`,
            meta: {
              datetime: new Date().toISOString(),
              user_id: 1,
              user_name: 'Coach'
            }
          });
        }
      });
    } catch (error) {
      console.error('Error loading video events:', error);
      alert('Failed to load video events: ' + error.message);
    }
  }

  // Event edit modal elements
const eventEditModal = document.getElementById('event-edit-modal');
const editEventType = document.getElementById('edit-event-type');
const editEventTimestamp = document.getElementById('edit-event-timestamp');
const editPlayerSelection = document.getElementById('edit-player-selection');
const eventEditSaveBtn = document.getElementById('event-edit-save-btn');
const eventDeleteBtn = document.getElementById('event-delete-btn');
const eventEditClose = eventEditModal.querySelector('.close');

// Current event being edited
let currentEditEventId = null;

// Helper function to update events list with edit buttons
function updateEventsList(events) {
  eventsList.innerHTML = '';
  
  events.forEach(event => {
    const div = document.createElement('div');
    div.className = 'event-item';
    div.dataset.id = event.id;
    div.dataset.timestamp = event.timestamp;
    
    // Format timestamp as MM:SS
    const minutes = Math.floor(event.timestamp / 60);
    const seconds = Math.floor(event.timestamp % 60);
    const formattedTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    
    const timestampSpan = document.createElement('span');
    timestampSpan.className = 'event-timestamp';
    timestampSpan.textContent = formattedTime;
    
    const typeSpan = document.createElement('span');
    typeSpan.className = 'event-type';
    typeSpan.textContent = event.event_type_name;
    
    const playersSpan = document.createElement('span');
    playersSpan.className = 'event-players';
    playersSpan.textContent = event.players.map(p => p.name).join(', ');
    
    // Add edit button
    const editBtn = document.createElement('button');
    editBtn.className = 'event-edit-btn';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent click from triggering event selection
      openEventEditModal(event.id);
    });
    
    div.appendChild(timestampSpan);
    div.appendChild(typeSpan);
    div.appendChild(playersSpan);
    div.appendChild(editBtn);
    
    eventsList.appendChild(div);
  });
}

// Function to open event edit modal
async function openEventEditModal(eventId) {
  try {
    // Get full event details
    const event = await window.api.getEvent(eventId);
    currentEditEventId = eventId;
    
    // Update modal with event info
    editEventType.textContent = event.event_type_name;
    
    // Format timestamp as MM:SS
    const minutes = Math.floor(event.timestamp / 60);
    const seconds = Math.floor(event.timestamp % 60);
    const formattedTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    editEventTimestamp.textContent = formattedTime;
    
    // Populate player checkboxes
    editPlayerSelection.innerHTML = '';
    
    // Create checkboxes for all players
    players.forEach(player => {
      const container = document.createElement('div');
      container.className = 'player-checkbox';
      
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = `edit-player-${player.id}`;
      checkbox.value = player.id;
      
      // Check if this player is associated with the event
      const isAssociated = event.players.some(p => p.id === player.id);
      checkbox.checked = isAssociated;
      
      const label = document.createElement('label');
      label.htmlFor = `edit-player-${player.id}`;
      label.textContent = player.name;
      
      container.appendChild(checkbox);
      container.appendChild(label);
      editPlayerSelection.appendChild(container);
    });
    
    // Show the modal
    eventEditModal.style.display = 'block';
  } catch (error) {
    console.error('Error loading event details:', error);
    alert('Failed to load event details: ' + error.message);
  }
}

// Save event changes
async function saveEventChanges() {
  if (!currentEditEventId) return;
  
  try {
    // Get selected players
    const selectedPlayerIds = Array.from(
      editPlayerSelection.querySelectorAll('input[type="checkbox"]:checked')
    ).map(checkbox => parseInt(checkbox.value));
    
    // Update player associations
    await window.api.updateEventPlayers(currentEditEventId, selectedPlayerIds);
    
    // Reload events for this video
    loadVideoEvents(currentVideoId);
    
    // Close the modal
    eventEditModal.style.display = 'none';
  } catch (error) {
    console.error('Error updating event:', error);
    alert('Failed to update event: ' + error.message);
  }
}

// Delete event
async function deleteEvent() {
  if (!currentEditEventId) return;
  
  if (confirm('Are you sure you want to delete this event?')) {
    try {
      await window.api.deleteEvent(currentEditEventId);
      
      // Reload events for this video
      loadVideoEvents(currentVideoId);
      
      // Close the modal
      eventEditModal.style.display = 'none';
    } catch (error) {
      console.error('Error deleting event:', error);
      alert('Failed to delete event: ' + error.message);
    }
  }
}

// Event listeners for the edit modal
eventEditSaveBtn.addEventListener('click', saveEventChanges);
eventDeleteBtn.addEventListener('click', deleteEvent);
eventEditClose.addEventListener('click', () => {
  eventEditModal.style.display = 'none';
});

// Modal click outside
window.addEventListener('click', event => {
  if (event.target === eventEditModal) {
    eventEditModal.style.display = 'none';
  }
});

  // Helper function to load events for a player
  async function loadPlayerEvents(playerId) {
    if (!playerId) return;
    
    try {
      const events = await window.api.getPlayerEvents(playerId);
      
      playerEvents.innerHTML = '';
      
      if (events.length === 0) {
        const emptyMessage = document.createElement('div');
        emptyMessage.className = 'empty-message';
        emptyMessage.textContent = 'No events found for this player';
        playerEvents.appendChild(emptyMessage);
        return;
      }
      
      let currentVideoId = null;
      let videoContainer = null;
      
      events.forEach(event => {
        // If this is a new video, create a new container
        if (event.video_id !== currentVideoId) {
          currentVideoId = event.video_id;
          
          // Get filename from file path
          const fileName = event.file_path.split(/[\\/]/).pop();
          
          videoContainer = document.createElement('div');
          videoContainer.className = 'player-event-video-container';
          
          const videoTitle = document.createElement('h3');
          videoTitle.className = 'player-event-video';
          videoTitle.textContent = fileName;
          
          videoContainer.appendChild(videoTitle);
          playerEvents.appendChild(videoContainer);
        }
        
        // Add event to current video container
        const eventItem = document.createElement('div');
        eventItem.className = 'player-event-item';
        eventItem.dataset.videoId = event.video_id;
        eventItem.dataset.timestamp = event.timestamp;
        
        // Format timestamp as MM:SS
        const minutes = Math.floor(event.timestamp / 60);
        const seconds = Math.floor(event.timestamp % 60);
        const formattedTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        
        const eventDetails = document.createElement('div');
        eventDetails.className = 'player-event-details';
        
        const timestampSpan = document.createElement('span');
        timestampSpan.className = 'event-timestamp';
        timestampSpan.textContent = formattedTime;
        
        const typeSpan = document.createElement('span');
        typeSpan.className = 'event-type';
        typeSpan.textContent = event.event_type_name;
        
        eventDetails.appendChild(timestampSpan);
        eventDetails.appendChild(typeSpan);
        
        eventItem.appendChild(eventDetails);
        videoContainer.appendChild(eventItem);
      });
    } catch (error) {
      console.error('Error loading player events:', error);
      alert('Failed to load player events: ' + error.message);
    }
  }
});