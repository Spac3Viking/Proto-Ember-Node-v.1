// public/app.js

const chatContainer = document.getElementById('chat-container');
const promptInput = document.getElementById('prompt-input');
const sendButton = document.getElementById('send-button');
const tabs = document.querySelectorAll('.tab');

// Function to send chat prompt to the /chat endpoint
async function sendChatPrompt(prompt) {
    const response = await fetch('/chat', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ prompt }),
    });
    return response.json();
}

// Function to display the chat response
function displayResponse(response) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('chat-response');
    messageElement.textContent = response.message;
    chatContainer.appendChild(messageElement);
}

// Event Listener for send button
sendButton.addEventListener('click', async () => {
    const prompt = promptInput.value;
    const response = await sendChatPrompt(prompt);
    displayResponse(response);
    promptInput.value = ''; // Clear the input field
});

// Tab switching functionality
function switchTab(event) {
    const targetTab = event.currentTarget.dataset.tab;
    tabs.forEach(tab => {
        tab.classList.remove('active');
        if (tab.id === targetTab) {
            tab.classList.add('active');
        }
    });
}

// Attach click events to tabs
tabs.forEach(tab => {
    tab.addEventListener('click', switchTab);
});
