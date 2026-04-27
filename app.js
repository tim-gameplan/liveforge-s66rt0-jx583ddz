// === LiveForge AI runtime (Phase 0 — local-dev only) ===
// This app is wired to LiveForge's local LiteLLM proxy. Calls work in the
// LiveForge preview pane. PUBLISHED apps (e.g. on GitHub Pages) will NOT
// be able to reach this URL — that needs the hosted relay (Phase 1).
// See docs/architecture/ai-native-apps.md.
const LF_LLM_URL = 'http://localhost:9120/v1/chat/completions';
const LF_MODEL = 'gemini-2.5-flash';

if (location.protocol !== 'file:' && !LF_LLM_URL.includes(location.host) && !LF_LLM_URL.startsWith('http://localhost')) {
  // (Always-true at runtime in Phase 0; placeholder for Phase 1 swap.)
}
async function llm(messages, opts = {}) {
  if (location.host && !location.host.includes('localhost') && !location.host.includes('127.0.0.1')) {
    console.warn('[LiveForge AI] This app is calling localhost:9120 but appears to be deployed publicly. AI features will fail until Phase 1 (hosted relay) ships. See docs/architecture/ai-native-apps.md.');
  }
  const res = await fetch(LF_LLM_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: opts.model || LF_MODEL,
      messages,
      ...(opts.tools ? { tools: opts.tools } : {}),
      ...(opts.max_tokens ? { max_tokens: opts.max_tokens } : {}),
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error('LLM call failed: ' + (err.error || res.status));
  }
  const data = await res.json();
  return data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content || ''
    : '';
}
async function chat(input, history = []) {
  const messages = [...history, { role: 'user', content: input }];
  const reply = await llm(messages);
  return { reply, history: [...messages, { role: 'assistant', content: reply }] };
}
// === end LiveForge AI runtime ===

// ===========================
// 1. Constants, theme tokens, and configuration
// ===========================

const CONFIG = {
  minZoom: 0.1,
  maxZoom: 3,
  zoomStep: 0.1,
  panSpeed: 1,
  dragMomentumDuration: 120,
  objectSpacing: 24,
  animationDefaults: {
    duration: 400,
    easing: 'easeOutElastic(1, .5)'
  },
  localStorageKey: 'infinite-canvas-state'
};

const ELEMENT_IDS = {
  emptyState: 'empty-state',
  canvasViewport: 'canvas-viewport',
  canvasContainer: 'canvas-container',
  conversationPanel: 'conversation-panel',
  conversationList: 'conversation-list',
  clearHistory: 'clear-history',
  zoomIn: 'zoom-in',
  zoomOut: 'zoom-out',
  resetView: 'reset-view',
  zoomLevel: 'zoom-level'
};

const TEMPLATES = {
  textInput: 'text-input-template',
  animatedObject: 'animated-object-template'
};

// ===========================
// 2. Application state: objects array, conversation history, viewport transform, selection
// ===========================

const state = {
  objects: [],
  conversations: [],
  viewport: {
    x: 0,
    y: 0,
    scale: 1
  },
  selectedObjectId: null,
  isPanning: false,
  isDragging: false,
  dragTarget: null,
  dragOffset: { x: 0, y: 0 },
  panStart: { x: 0, y: 0 },
  nextObjectId: 1,
  conversationPanelVisible: false,
  contextMenu: null
};

function saveState() {
  try {
    const stateToSave = {
      objects: state.objects,
      conversations: state.conversations,
      viewport: state.viewport,
      nextObjectId: state.nextObjectId
    };
    localStorage.setItem(CONFIG.localStorageKey, JSON.stringify(stateToSave));
  } catch (e) {
    console.warn('Failed to save state:', e);
  }
}

function loadState() {
  try {
    const saved = localStorage.getItem(CONFIG.localStorageKey);
    if (saved) {
      const parsed = JSON.parse(saved);
      state.objects = parsed.objects || [];
      state.conversations = parsed.conversations || [];
      state.viewport = parsed.viewport || { x: 0, y: 0, scale: 1 };
      state.nextObjectId = parsed.nextObjectId || 1;
      return true;
    }
  } catch (e) {
    console.warn('Failed to load state:', e);
  }
  return false;
}

function clearState() {
  state.objects = [];
  state.conversations = [];
  state.viewport = { x: 0, y: 0, scale: 1 };
  state.selectedObjectId = null;
  state.nextObjectId = 1;
  saveState();
}

// ===========================
// 3. Click-to-type: create text input bubbles at click coordinates
// ===========================

function createTextInput(canvasX, canvasY) {
  const template = document.getElementById(TEMPLATES.textInput);
  const clone = template.content.cloneNode(true);
  const bubble = clone.querySelector('.text-input-bubble');
  
  const inputId = `input-${Date.now()}`;
  bubble.dataset.inputId = inputId;
  bubble.style.left = `${canvasX}px`;
  bubble.style.top = `${canvasY}px`;
  
  const textarea = bubble.querySelector('.text-input-field');
  const askBtn = bubble.querySelector('.ask-llm-btn');
  
  // Auto-resize textarea
  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
  });
  
  // Handle Enter key (with Shift for new line)
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      askBtn.click();
    }
  });
  
  // Handle Ask LLM button
  askBtn.addEventListener('click', async () => {
    const prompt = textarea.value.trim();
    if (!prompt) return;
    
    askBtn.disabled = true;
    askBtn.textContent = 'Thinking...';
    bubble.classList.add('loading');
    
    try {
      await handleLLMRequest(prompt, canvasX, canvasY);
      bubble.remove();
    } catch (error) {
      console.error('LLM request failed:', error);
      askBtn.disabled = false;
      askBtn.textContent = 'Try Again';
      bubble.classList.remove('loading');
    }
  });
  
  // Make draggable
  makeDraggable(bubble, textarea);
  
  const container = document.getElementById(ELEMENT_IDS.canvasContainer);
  container.appendChild(bubble);
  
  // Focus the textarea
  setTimeout(() => textarea.focus(), 100);
  
  updateEmptyState();
}

function makeDraggable(element, excludeElement = null) {
  let isDragging = false;
  let startX, startY, initialLeft, initialTop;
  
  const onMouseDown = (e) => {
    if (excludeElement && e.target === excludeElement) return;
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'TEXTAREA') return;
    
    isDragging = true;
    element.classList.add('dragging');
    
    const rect = element.getBoundingClientRect();
    const containerRect = element.parentElement.getBoundingClientRect();
    
    startX = e.clientX;
    startY = e.clientY;
    initialLeft = rect.left - containerRect.left;
    initialTop = rect.top - containerRect.top;
    
    e.preventDefault();
  };
  
  const onMouseMove = (e) => {
    if (!isDragging) return;
    
    const dx = (e.clientX - startX) / state.viewport.scale;
    const dy = (e.clientY - startY) / state.viewport.scale;
    
    element.style.left = `${initialLeft + dx}px`;
    element.style.top = `${initialTop + dy}px`;
  };
  
  const onMouseUp = () => {
    if (isDragging) {
      isDragging = false;
      element.classList.remove('dragging');
    }
  };
  
  element.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}

// ===========================
// 4. LLM integration: send prompt via chat(), parse response for Anime.js configs
// ===========================

async function handleLLMRequest(userPrompt, x, y) {
  const systemPrompt = `You are an assistant that creates animated objects using Anime.js. When the user describes what they want to see, respond with a JSON array of object configurations. Each object should have:
{
  "type": "circle" | "square" | "triangle" | "custom",
  "label": "brief description",
  "style": {
    "width": "80px",
    "height": "80px",
    "background": "#00d9ff",
    "borderRadius": "50%" (optional),
    ... other CSS properties
  },
  "animation": {
    "translateX": [0, 100],
    "rotate": [0, 360],
    "scale": [1, 1.5],
    "duration": 2000,
    "easing": "easeInOutQuad",
    "loop": true,
    "direction": "alternate"
    ... any Anime.js properties
  },
  "position": {
    "x": 0,
    "y": 0
  }
}

For example, if user says "show me a solar system", return an array with a sun (large circle) and planets (smaller circles with orbital animations).

Important: Return ONLY the JSON array, no markdown, no explanation. The array should be valid JSON that can be parsed directly.`;

  const response = await chat(userPrompt, { system: systemPrompt });
  
  // Add to conversation history
  state.conversations.push({
    id: Date.now(),
    timestamp: new Date().toISOString(),
    userPrompt,
    llmResponse: response,
    position: { x, y }
  });
  
  // Try to parse as JSON array
  let objectConfigs;
  try {
    // Clean up response - remove markdown code fences if present
    let cleanResponse = response.trim();
    if (cleanResponse.startsWith('```')) {
      cleanResponse = cleanResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    }
    
    objectConfigs = JSON.parse(cleanResponse);
    if (!Array.isArray(objectConfigs)) {
      objectConfigs = [objectConfigs];
    }
  } catch (e) {
    // If parsing fails, create a text response card
    createLLMResponseCard(response, x, y);
    saveState();
    renderConversationHistory();
    return;
  }
  
  // Create animated objects from configs
  objectConfigs.forEach((config, index) => {
    const offsetX = x + (index * (CONFIG.objectSpacing * 4));
    const offsetY = y + (config.position?.y || 0);
    createAnimatedObject(config, offsetX, offsetY);
  });
  
  saveState();
  renderConversationHistory();
  updateEmptyState();
}

function createLLMResponseCard(responseText, x, y) {
  const card = document.createElement('div');
  card.className = 'llm-response-card';
  card.style.left = `${x}px`;
  card.style.top = `${y + 80}px`;
  
  const content = document.createElement('div');
  content.className = 'llm-response-content';
  content.textContent = responseText;
  
  card.appendChild(content);
  makeDraggable(card);
  
  const container = document.getElementById(ELEMENT_IDS.canvasContainer);
  container.appendChild(card);
}

// ===========================
// 5. Object renderer: create DOM elements and apply Anime.js animations
// ===========================

function createAnimatedObject(config, x, y) {
  const template = document.getElementById(TEMPLATES.animatedObject);
  const clone = template.content.cloneNode(true);
  const objectEl = clone.querySelector('.animated-object');
  
  const objectId = state.nextObjectId++;
  objectEl.dataset.objectId = objectId;
  objectEl.style.left = `${x}px`;
  objectEl.style.top = `${y}px`;
  
  const contentEl = objectEl.querySelector('.object-content');
  const labelEl = objectEl.querySelector('.object-label');
  
  // Apply label
  labelEl.textContent = config.label || 'Object';
  
  // Create the visual element based on type
  let visualElement;
  if (config.type === 'circle') {
    visualElement = document.createElement('div');
    visualElement.className = 'circle';
  } else if (config.type === 'square') {
    visualElement = document.createElement('div');
    visualElement.className = 'square';
  } else if (config.type === 'triangle') {
    visualElement = document.createElement('div');
    visualElement.className = 'triangle';
  } else {
    visualElement = document.createElement('div');
  }
  
  // Apply custom styles
  if (config.style) {
    Object.assign(visualElement.style, config.style);
  }
  
  contentEl.appendChild(visualElement);
  
  // Make object selectable and draggable
  objectEl.addEventListener('click', (e) => {
    e.stopPropagation();
    selectObject(objectId);
  });
  
  objectEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, objectId);
  });
  
  makeObjectDraggable(objectEl);
  
  const container = document.getElementById(ELEMENT_IDS.canvasContainer);
  container.appendChild(objectEl);
  
  // Store in state
  state.objects.push({
    id: objectId,
    config,
    position: { x, y },
    element: objectEl
  });
  
  // Apply Anime.js animation if configured
  if (config.animation) {
    const animConfig = {
      targets: visualElement,
      ...config.animation,
      duration: config.animation.duration || CONFIG.animationDefaults.duration,
      easing: config.animation.easing || CONFIG.animationDefaults.easing
    };
    
    anime(animConfig);
  }
  
  return objectId;
}

function makeObjectDraggable(objectEl) {
  let isDragging = false;
  let startX, startY, initialLeft, initialTop;
  
  const onMouseDown = (e) => {
    if (e.target.tagName === 'BUTTON') return;
    
    isDragging = true;
    objectEl.classList.add('dragging');
    
    const rect = objectEl.getBoundingClientRect();
    const containerRect = objectEl.parentElement.getBoundingClientRect();
    
    startX = e.clientX;
    startY = e.clientY;
    initialLeft = rect.left - containerRect.left;
    initialTop = rect.top - containerRect.top;
    
    e.stopPropagation();
    e.preventDefault();
  };
  
  const onMouseMove = (e) => {
    if (!isDragging) return;
    
    const dx = (e.clientX - startX) / state.viewport.scale;
    const dy = (e.clientY - startY) / state.viewport.scale;
    
    const newLeft = initialLeft + dx;
    const newTop = initialTop + dy;
    
    objectEl.style.left = `${newLeft}px`;
    objectEl.style.top = `${newTop}px`;
    
    // Update state
    const objectId = parseInt(objectEl.dataset.objectId);
    const obj = state.objects.find(o => o.id === objectId);
    if (obj) {
      obj.position.x = newLeft;
      obj.position.y = newTop;
    }
  };
  
  const onMouseUp = () => {
    if (isDragging) {
      isDragging = false;
      objectEl.classList.remove('dragging');
      saveState();
    }
  };
  
  objectEl.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}

function renderExistingObjects() {
  const container = document.getElementById(ELEMENT_IDS.canvasContainer);
  
  state.objects.forEach(obj => {
    createAnimatedObject(obj.config, obj.position.x, obj.position.y);
  });
}

// ===========================
// 6. Object management: select, edit, delete, context menu actions
// ===========================

function selectObject(objectId) {
  // Deselect previous
  if (state.selectedObjectId !== null) {
    const prevSelected = document.querySelector(`[data-object-id="${state.selectedObjectId}"]`);
    if (prevSelected) {
      prevSelected.classList.remove('selected');
    }
  }
  
  // Select new
  state.selectedObjectId = objectId;
  const objectEl = document.querySelector(`[data-object-id="${objectId}"]`);
  if (objectEl) {
    objectEl.classList.add('selected');
  }
  
  hideContextMenu();
}

function deselectObject() {
  if (state.selectedObjectId !== null) {
    const selected = document.querySelector(`[data-object-id="${state.selectedObjectId}"]`);
    if (selected) {
      selected.classList.remove('selected');
    }
    state.selectedObjectId = null;
  }
}

function deleteObject(objectId) {
  const objectEl = document.querySelector(`[data-object-id="${objectId}"]`);
  if (objectEl) {
    // Animate out
    anime({
      targets: objectEl,
      opacity: 0,
      scale: 0,
      duration: 300,
      easing: 'easeInQuad',
      complete: () => {
        objectEl.remove();
      }
    });
  }
  
  state.objects = state.objects.filter(o => o.id !== objectId);
  if (state.selectedObjectId === objectId) {
    state.selectedObjectId = null;
  }
  
  saveState();
  updateEmptyState();
}

function duplicateObject(objectId) {
  const obj = state.objects.find(o => o.id === objectId);
  if (!obj) return;
  
  const newX = obj.position.x + CONFIG.objectSpacing * 2;
  const newY = obj.position.y + CONFIG.objectSpacing * 2;
  
  createAnimatedObject(obj.config, newX, newY);
  saveState();
}

function showContextMenu(clientX, clientY, objectId) {
  hideContextMenu();
  
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.left = `${clientX}px`;
  menu.style.top = `${clientY}px`;
  
  const actions = [
    { label: 'Duplicate', handler: () => duplicateObject(objectId) },
    { label: 'Delete', handler: () => deleteObject(objectId) }
  ];
  
  actions.forEach((action, index) => {
    const item = document.createElement('button');
    item.className = 'context-menu-item';
    item.textContent = action.label;
    item.addEventListener('click', () => {
      action.handler();
      hideContextMenu();
    });
    menu.appendChild(item);
    
    if (index < actions.length - 1) {
      const divider = document.createElement('div');
      divider.className = 'context-menu-divider';
      menu.appendChild(divider);
    }
  });
  
  document.body.appendChild(menu);
  state.contextMenu = menu;
  
  // Close on click outside
  setTimeout(() => {
    document.addEventListener('click', hideContextMenu, { once: true });
  }, 0);
}

function hideContextMenu() {
  if (state.contextMenu) {
    state.contextMenu.remove();
    state.contextMenu = null;
  }
}

// ===========================
// 7. Conversation history panel: render messages, toggle visibility
// ===========================

function renderConversationHistory() {
  const list = document.getElementById(ELEMENT_IDS.conversationList);
  list.innerHTML = '';
  
  if (state.conversations.length === 0) {
    const empty = document.createElement('div');
    empty.style.padding = 'var(--space-lg)';
    empty.style.textAlign = 'center';
    empty.style.color = 'rgba(245, 245, 247, 0.4)';
    empty.textContent = 'No conversations yet';
    list.appendChild(empty);
    return;
  }
  
  // Reverse to show newest first
  const sorted = [...state.conversations].reverse();
  
  sorted.forEach(conv => {
    const item = document.createElement('div');
    item.className = 'conversation-item';
    
    const userText = document.createElement('div');
    userText.className = 'conversation-item-user';
    userText.textContent = conv.userPrompt;
    
    const llmText = document.createElement('div');
    llmText.className = 'conversation-item-llm';
    llmText.textContent = conv.llmResponse;
    
    const timestamp = document.createElement('div');
    timestamp.className = 'conversation-item-timestamp';
    timestamp.textContent = formatTimestamp(conv.timestamp);
    
    item.appendChild(userText);
    item.appendChild(llmText);
    item.appendChild(timestamp);
    
    // Click to pan to conversation location
    item.addEventListener('click', () => {
      panToPosition(conv.position.x, conv.position.y);
    });
    
    list.appendChild(item);
  });
}

function formatTimestamp(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const diff = now - date;
  
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  
  return date.toLocaleDateString();
}

function toggleConversationPanel() {
  const panel = document.getElementById(ELEMENT_IDS.conversationPanel);
  state.conversationPanelVisible = !state.conversationPanelVisible;
  
  if (state.conversationPanelVisible) {
    panel.classList.add('visible');
    renderConversationHistory();
  } else {
    panel.classList.remove('visible');
  }
}

function createPanelToggleButton() {
  const existing = document.querySelector('.panel-toggle');
  if (existing) return;
  
  const button = document.createElement('button');
  button.className = 'panel-toggle';
  button.title = 'Toggle Conversation History';
  button.innerHTML = `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M3 12h18M3 6h18M3 18h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
  `;
  button.addEventListener('click', toggleConversationPanel);
  document.body.appendChild(button);
}

function clearConversationHistory() {
  if (confirm('Clear all conversation history?')) {
    state.conversations = [];
    renderConversationHistory();
    saveState();
  }
}

// ===========================
// 8. Init: attach global event listeners, restore state, render existing objects
// ===========================

function updateEmptyState() {
  const emptyState = document.getElementById(ELEMENT_IDS.emptyState);
  const hasContent = state.objects.length > 0 || 
                     document.querySelectorAll('.text-input-bubble').length > 0 ||
                     document.querySelectorAll('.llm-response-card').length > 0;
  
  if (hasContent) {
    emptyState.classList.add('hidden');
  } else {
    emptyState.classList.remove('hidden');
  }
}

function updateViewportTransform() {
  const container = document.getElementById(ELEMENT_IDS.canvasContainer);
  container.style.transform = `translate(${state.viewport.x}px, ${state.viewport.y}px) scale(${state.viewport.scale})`;
  
  const zoomLevelEl = document.getElementById(ELEMENT_IDS.zoomLevel);
  zoomLevelEl.textContent = `${Math.round(state.viewport.scale * 100)}%`;
}

function handleCanvasClick(e) {
  const viewport = document.getElementById(ELEMENT_IDS.canvasViewport);
  if (e.target !== viewport && e.target !== document.getElementById(ELEMENT_IDS.canvasContainer)) {
    return;
  }
  
  deselectObject();
  hideContextMenu();
  
  const rect = viewport.getBoundingClientRect();
  const viewportX = e.clientX - rect.left;
  const viewportY = e.clientY - rect.top;
  
  // Convert viewport coordinates to canvas coordinates
  const canvasX = (viewportX - state.viewport.x) / state.viewport.scale;
  const canvasY = (viewportY - state.viewport.y) / state.viewport.scale;
  
  createTextInput(canvasX, canvasY);
}

function handlePanStart(e) {
  const viewport = document.getElementById(ELEMENT_IDS.canvasViewport);
  if (e.target !== viewport && e.target !== document.getElementById(ELEMENT_IDS.canvasContainer)) {
    return;
  }
  
  state.isPanning = true;
  state.panStart = {
    x: e.clientX - state.viewport.x,
    y: e.clientY - state.viewport.y
  };
  
  viewport.classList.add('grabbing');
  e.preventDefault();
}

function handlePanMove(e) {
  if (!state.isPanning) return;
  
  state.viewport.x = e.clientX - state.panStart.x;
  state.viewport.y = e.clientY - state.panStart.y;
  
  updateViewportTransform();
}

function handlePanEnd() {
  if (state.isPanning) {
    state.isPanning = false;
    const viewport = document.getElementById(ELEMENT_IDS.canvasViewport);
    viewport.classList.remove('grabbing');
    saveState();
  }
}

function handleZoom(delta, centerX = null, centerY = null) {
  const oldScale = state.viewport.scale;
  const zoomFactor = delta > 0 ? (1 + CONFIG.zoomStep) : (1 - CONFIG.zoomStep);
  let newScale = oldScale * zoomFactor;
  
  newScale = Math.max(CONFIG.minZoom, Math.min(CONFIG.maxZoom, newScale));
  
  if (newScale === oldScale) return;
  
  // Zoom toward cursor position if provided
  if (centerX !== null && centerY !== null) {
    const scaleChange = newScale / oldScale;
    state.viewport.x = centerX - (centerX - state.viewport.x) * scaleChange;
    state.viewport.y = centerY - (centerY - state.viewport.y) * scaleChange;
  }
  
  state.viewport.scale = newScale;
  updateViewportTransform();
  saveState();
}

function handleWheel(e) {
  e.preventDefault();
  
  const rect = e.currentTarget.getBoundingClientRect();
  const centerX = e.clientX - rect.left;
  const centerY = e.clientY - rect.top;
  
  handleZoom(-e.deltaY, centerX, centerY);
}

function panToPosition(x, y) {
  const viewport = document.getElementById(ELEMENT_IDS.canvasViewport);
  const rect = viewport.getBoundingClientRect();
  
  // Center the position in the viewport
  const targetX = rect.width / 2 - x * state.viewport.scale;
  const targetY = rect.height / 2 - y * state.viewport.scale;
  
  anime({
    targets: state.viewport,
    x: targetX,
    y: targetY,
    duration: 600,
    easing: 'easeOutQuad',
    update: updateViewportTransform
  });
  
  saveState();
}

function resetView() {
  anime({
    targets: state.viewport,
    x: 0,
    y: 0,
    scale: 1,
    duration: 400,
    easing: 'easeOutQuad',
    update: updateViewportTransform,
    complete: saveState
  });
}

function initializeEventListeners() {
  const viewport = document.getElementById(ELEMENT_IDS.canvasViewport);
  
  // Canvas click to create input
  viewport.addEventListener('click', handleCanvasClick);
  
  // Pan with mouse drag
  viewport.addEventListener('mousedown', handlePanStart);
  document.addEventListener('mousemove', handlePanMove);
  document.addEventListener('mouseup', handlePanEnd);
  
  // Zoom with wheel
  viewport.addEventListener('wheel', handleWheel, { passive: false });
  
  // Zoom controls
  document.getElementById(ELEMENT_IDS.zoomIn).addEventListener('click', () => {
    handleZoom(1);
  });
  
  document.getElementById(ELEMENT_IDS.zoomOut).addEventListener('click', () => {
    handleZoom(-1);
  });
  
  document.getElementById(ELEMENT_IDS.resetView).addEventListener('click', resetView);
  
  // Clear history button
  document.getElementById(ELEMENT_IDS.clearHistory).addEventListener('click', clearConversationHistory);
  
  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' && state.selectedObjectId !== null) {
      deleteObject(state.selectedObjectId);
    }
    
    if (e.key === 'Escape') {
      deselectObject();
      hideContextMenu();
    }
    
    if (e.key === 'd' && e.ctrlKey && state.selectedObjectId !== null) {
      e.preventDefault();
      duplicateObject(state.selectedObjectId);
    }
  });
  
  // Click outside to deselect
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.animated-object') && !e.target.closest('.context-menu')) {
      deselectObject();
    }
  });
}

function init() {
  // Load saved state
  const hasState = loadState();
  
  // Update viewport transform
  updateViewportTransform();
  
  // Render existing objects if any
  if (hasState && state.objects.length > 0) {
    // Clear objects array but keep configs
    const objectConfigs = state.objects.map(obj => ({
      config: obj.config,
      position: obj.position
    }));
    
    state.objects = [];
    
    objectConfigs.forEach(({ config, position }) => {
      createAnimatedObject(config, position.x, position.y);
    });
  }
  
  // Initialize UI
  createPanelToggleButton();
  renderConversationHistory();
  updateEmptyState();
  
  // Attach event listeners
  initializeEventListeners();
}

// Start the app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}