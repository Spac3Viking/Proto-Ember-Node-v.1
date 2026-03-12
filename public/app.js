// Updated app.js for chat handling

const chatContainer = document.querySelector('#messages');
const messageInput = document.querySelector('#message-input');
const sendButton = document.querySelector('#send-button');

// Function to send chat prompt
sendButton.addEventListener('click', async () => {
    const message = messageInput.value;
    const response = await fetch('/chat', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({message: message}),
    });
    const data = await response.json();
    displayMessage(message, 'message-user');
    displayMessage(data.response, 'message-heart');
    messageInput.value = '';
    autoScrollToBottom();
});

// Function to display messages
function displayMessage(text, className) {
    const msgElement = document.createElement('div');
    msgElement.className = className;
    msgElement.textContent = text;
    chatContainer.appendChild(msgElement);
}

// Function to auto-scroll chat window
function autoScrollToBottom() {
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Function for tab switching between rooms
function switchTab(room) {
    // Logic to switch between Hearth, Workshop, and Threshold
}

// Additional event listeners for tab switching can be added here
