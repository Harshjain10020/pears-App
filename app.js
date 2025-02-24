import Hyperswarm from 'hyperswarm'
import crypto from 'hypercore-crypto'
import b4a from 'b4a'
const { teardown, updates } = Pear

// Initialize P2P network
const swarm = new Hyperswarm()
let evidenceItems = []
let currentRoomId = null

// Cleanup on exit
teardown(() => swarm.destroy())

// Enable auto-reload during development
updates(() => Pear.reload())

// Handle peer connections
swarm.on('connection', (peer) => {
  const peerId = b4a.toString(peer.remotePublicKey, 'hex').substr(0, 6)
  
  // When we receive data from a peer
  peer.on('data', data => {
    const message = JSON.parse(b4a.toString(data))
    onMessageReceived(message, peerId)
  })
  
  peer.on('error', e => console.log(`Connection error: ${e}`))
})

// Update connected peers count
swarm.on('update', () => {
  document.querySelector('#peers-count').textContent = swarm.connections.size
})

// Create a new investigation room
async function createInvestigation() {
  const topicBuffer = crypto.randomBytes(32)
  const roomId = b4a.toString(topicBuffer, 'hex')
  await joinInvestigation(roomId)
}

// Join an existing investigation
async function joinInvestigation(roomId) {
  document.querySelector('#setup').classList.add('hidden')
  document.querySelector('#loading').classList.remove('hidden')

  currentRoomId = roomId
  const topicBuffer = b4a.from(roomId, 'hex')
  
  // Join the swarm with the room topic
  const discovery = swarm.join(topicBuffer, { client: true, server: true })
  await discovery.flushed()

  // Update UI
  document.querySelector('#investigation-topic').textContent = roomId
  document.querySelector('#loading').classList.add('hidden')
  document.querySelector('#investigation').classList.remove('hidden')
}

// Broadcast to all peers in the room
function broadcastToPeers(message) {
  const messageData = JSON.stringify({
    ...message,
    roomId: currentRoomId
  })
  
  const peers = [...swarm.connections]
  for (const peer of peers) {
    peer.write(b4a.from(messageData))
  }
}

// Handle received messages
function onMessageReceived(message, peerId) {
  // Only process messages for current room
  if (message.roomId !== currentRoomId) return
  
  switch (message.type) {
    case 'evidence':
      onEvidenceReceived(message.evidence, peerId)
      break
    case 'chat':
      addChatMessage(peerId, message.content)
      break
    case 'vote':
      updateEvidenceVotes(message.evidenceId, message.votes)
      break
  }
}

// Handle received evidence
function onEvidenceReceived(evidence, peerId) {
  if (!evidenceItems.some(e => e.id === evidence.id)) {
    evidenceItems.push(evidence)
    renderEvidence(evidence, peerId)
  }
}

// Create and broadcast new evidence
async function shareEvidence(formData) {
  const evidence = {
    id: Date.now().toString(),
    timestamp: new Date().toISOString(),
    votes: 0,
    ...formData
  }
  
  evidenceItems.push(evidence)
  broadcastToPeers({
    type: 'evidence',
    evidence: evidence
  })
  renderEvidence(evidence, 'You')
}

// Create DOM element for evidence
function renderEvidence(evidence, sharedBy) {
  const div = document.createElement('div')
  div.className = 'evidence-item'
  div.innerHTML = `
    <div class="evidence-header">
      <strong>${evidence.name}</strong> (shared by ${sharedBy})
    </div>
    <div class="evidence-content">
      ${evidence.fileData ? `<img src="${evidence.fileData}" alt="Evidence" class="evidence-image"/>` : ''}
      <p>${evidence.description || ''}</p>
    </div>
    <div class="evidence-controls">
      <button class="vote-button" data-evidence-id="${evidence.id}">
        👍 <span class="vote-count">${evidence.votes}</span>
      </button>
    </div>
    <div class="metadata">
      Shared at: ${new Date(evidence.timestamp).toLocaleString()}
    </div>
  `
  
  // Add vote button handler
  const voteButton = div.querySelector('.vote-button')
  voteButton.addEventListener('click', () => handleVote(evidence.id))
  
  document.querySelector('#evidence-items').appendChild(div)
}

// Handle voting on evidence
function handleVote(evidenceId) {
  const evidence = evidenceItems.find(e => e.id === evidenceId)
  if (evidence) {
    evidence.votes++
    broadcastToPeers({
      type: 'vote',
      evidenceId: evidenceId,
      votes: evidence.votes
    })
    updateEvidenceVotes(evidenceId, evidence.votes)
  }
}

// Update vote display
function updateEvidenceVotes(evidenceId, newVotes) {
  const voteCount = document.querySelector(`button[data-evidence-id="${evidenceId}"] .vote-count`)
  if (voteCount) {
    voteCount.textContent = newVotes
  }
}

// Add chat message to display
function addChatMessage(from, content) {
  const div = document.createElement('div')
  div.textContent = `<${from}> ${content}`
  const messagesDiv = document.querySelector('#messages')
  messagesDiv.appendChild(div)
  messagesDiv.scrollTop = messagesDiv.scrollHeight
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
  // Handle investigation creation
  document.querySelector('#create-investigation').addEventListener('click', createInvestigation)
  
  // Handle investigation joining
  document.querySelector('#join-form').addEventListener('submit', (e) => {
    e.preventDefault()
    const roomId = document.querySelector('#join-investigation-topic').value
    joinInvestigation(roomId)
  })
  
  // Handle evidence form submission
  document.querySelector('#file-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    
    const fileInput = document.querySelector('#file-input')
    const formData = {
      name: fileInput.files[0]?.name || 'Untitled Evidence',
      type: fileInput.files[0]?.type || 'text/plain',
      fileData: null
    }
    
    // Handle file if present
    if (fileInput.files[0]) {
      formData.fileData = await readFileAsDataURL(fileInput.files[0])
    }
    
    shareEvidence(formData)
    fileInput.value = ''
  })
  
  // Handle chat messages
  document.querySelector('#message-form').addEventListener('submit', (e) => {
    e.preventDefault()
    const messageInput = document.querySelector('#message')
    const content = messageInput.value
    
    if (content.trim()) {
      broadcastToPeers({
        type: 'chat',
        content: content
      })
      addChatMessage('You', content)
      messageInput.value = ''
    }
  })
})

// Helper function to read file as Data URL
function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}