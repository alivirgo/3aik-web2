/**
 * LLM Chat App Frontend
 *
 * Handles the chat UI interactions and communication with the backend API.
 */

// DOM elements
const chatMessages = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");
const sendButton = document.getElementById("send-button");
const typingIndicator = document.getElementById("typing-indicator");

// Chat state
let chatHistory = [
	{
		role: "assistant",
		content:
			"Hello! I'm an AI assistant that can generate text and images. Use `image:` to create images.",
	},
];
let isProcessing = false;

// Detect image intent
function isImagePrompt(text) {
	return text.toLowerCase().startsWith("image:");
}

// Auto-resize textarea as user types
userInput.addEventListener("input", function () {
	this.style.height = "auto";
	this.style.height = this.scrollHeight + "px";
});

// Send message on Enter (without Shift)
userInput.addEventListener("keydown", function (e) {
	if (e.key === "Enter" && !e.shiftKey) {
		e.preventDefault();
		sendMessage();
	}
});

// Send button click handler
sendButton.addEventListener("click", sendMessage);

/**
 * Sends a message to the chat API and processes the response
 */
async function sendMessage() {
	const message = userInput.value.trim();
	if (message === "" || isProcessing) return;

	const imageMode = isImagePrompt(message);

	// Disable input while processing
	isProcessing = true;
	userInput.disabled = true;
	sendButton.disabled = true;

	// Add user message
	addMessageToChat("user", message);

	// Clear input
	userInput.value = "";
	userInput.style.height = "auto";

	// Show typing indicator
	typingIndicator.classList.add("visible");

	if (!imageMode) {
		chatHistory.push({ role: "user", content: message });
	}

	try {
		// Image generation path
		if (imageMode) {
			const response = await fetch("/api/image", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					prompt: message.replace(/^image:\s*/i, ""),
				}),
			});

			if (!response.ok) {
				throw new Error("Image generation failed");
			}

			const result = await response.json();

			const img = document.createElement("img");
			img.src = `data:image/png;base64,${result.images[0]}`;
			img.style.maxWidth = "100%";
			img.style.borderRadius = "8px";

			const imgWrapper = document.createElement("div");
			imgWrapper.className = "message assistant-message";
			imgWrapper.appendChild(img);

			chatMessages.appendChild(imgWrapper);
			chatMessages.scrollTop = chatMessages.scrollHeight;

			return;
		}

		// Text chat path (unchanged SSE logic)
		const assistantMessageEl = document.createElement("div");
		assistantMessageEl.className = "message assistant-message";
		assistantMessageEl.innerHTML = "<p></p>";
		chatMessages.appendChild(assistantMessageEl);
		const assistantTextEl = assistantMessageEl.querySelector("p");

		const response = await fetch("/api/chat", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ messages: chatHistory }),
		});

		if (!response.ok || !response.body) {
			throw new Error("Chat request failed");
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let responseText = "";
		let buffer = "";

		const flush = () => {
			assistantTextEl.textContent = responseText;
			chatMessages.scrollTop = chatMessages.scrollHeight;
		};

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const parsed = consumeSseEvents(buffer);
			buffer = parsed.buffer;

			for (const data of parsed.events) {
				if (data === "[DONE]") break;
				try {
					const json = JSON.parse(data);
					const content =
						json.response ||
						json.choices?.[0]?.delta?.content ||
						"";
					if (content) {
						responseText += content;
						flush();
					}
				} catch {}
			}
		}

		if (responseText) {
			chatHistory.push({ role: "assistant", content: responseText });
		}
	} catch (error) {
		console.error(error);
		addMessageToChat(
			"assistant",
			"Sorry, something went wrong. Please try again.",
		);
	} finally {
		typingIndicator.classList.remove("visible");
		isProcessing = false;
		userInput.disabled = false;
		sendButton.disabled = false;
		userInput.focus();
	}
}

/**
 * Helper function to add message to chat
 */
function addMessageToChat(role, content) {
	const messageEl = document.createElement("div");
	messageEl.className = `message ${role}-message`;
	messageEl.innerHTML = `<p>${content}</p>`;
	chatMessages.appendChild(messageEl);
	chatMessages.scrollTop = chatMessages.scrollHeight;
}

function consumeSseEvents(buffer) {
	let normalized = buffer.replace(/\r/g, "");
	const events = [];
	let index;

	while ((index = normalized.indexOf("\n\n")) !== -1) {
		const raw = normalized.slice(0, index);
		normalized = normalized.slice(index + 2);

		const lines = raw.split("\n");
		const dataLines = lines
			.filter((l) => l.startsWith("data:"))
			.map((l) => l.slice(5).trimStart());

		if (dataLines.length) {
			events.push(dataLines.join("\n"));
		}
	}

	return { events, buffer: normalized };
}