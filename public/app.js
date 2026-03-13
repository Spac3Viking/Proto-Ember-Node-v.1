// Updated app.js for chat handling

const chatContainer = document.querySelector('#messages');
const messageInput = document.querySelector('#message-input');
const sendButton = document.querySelector('#send-button');

// Function to send chat prompt
sendButton.addEventListener('click', async () => {
    const message = messageInput.value.trim();
    if (!message) return;

    displayMessage(message, 'message-user');
    messageInput.value = '';
    autoScrollToBottom();

    try {
        const response = await fetch('/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message }),
        });

        const data = await response.json();

        if (data && data.message && data.message.content) {
            displayMessage(data.message.content, 'message-heart');
        } else {
            displayMessage("Model returned an unexpected response.", 'message-heart');
        }
        autoScrollToBottom();
    } catch (error) {
        displayMessage('Error: could not reach the Heart.', 'message-heart');
        autoScrollToBottom();
    }
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

messageInput.addEventListener("keypress", function(e) {
    if (e.key === "Enter") {
        sendButton.click();
    }
});
