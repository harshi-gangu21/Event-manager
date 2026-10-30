import { useEffect, useRef, useState } from "react";

const CHAT_HISTORY_LIMIT = 10;

export default function ChatWidget({ apiUrl }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const messageListRef = useRef(null);

  useEffect(() => {
    if (open && messageListRef.current) {
      messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
    }
  }, [open, messages, loading]);

  async function sendMessage(event) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || loading) return;

    const history = messages.slice(-CHAT_HISTORY_LIMIT).map(({ role, content }) => ({ role, content }));
    setMessages((current) => [...current, { role: "user", content: message }]);
    setDraft("");
    setError("");
    setLoading(true);
    try {
      const response = await fetch(apiUrl("/api/chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The assistant couldn't reply. Please try again.");
      setMessages((current) => [...current, { role: "assistant", content: data.reply }]);
    } catch (requestError) {
      setError(requestError instanceof TypeError
        ? "Couldn't reach the assistant. Please check your connection and try again."
        : requestError.message || "The assistant couldn't reply. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="chat-widget">
      {open && (
        <section className="chat-panel" role="dialog" aria-modal="false" aria-labelledby="chat-title">
          <header className="chat-header">
            <div>
              <span className="chat-eyebrow">GATHER SUPPORT</span>
              <h2 id="chat-title">Ask about events</h2>
            </div>
            <button type="button" className="chat-close" onClick={() => setOpen(false)} aria-label="Close chat">×</button>
          </header>
          <div className="chat-messages" ref={messageListRef} aria-live="polite">
            {messages.length === 0 && (
              <p className="chat-welcome">Hi! Ask me about event dates, venues, categories, prices, or availability.</p>
            )}
            {messages.map((message, index) => (
              <p className={`chat-message ${message.role}`} key={`${index}-${message.role}`}>{message.content}</p>
            ))}
            {loading && <p className="chat-typing" role="status">Gather is thinking<span>...</span></p>}
            {error && <p className="chat-error" role="alert">{error}</p>}
          </div>
          <form className="chat-form" onSubmit={sendMessage}>
            <textarea
              aria-label="Message the event assistant"
              placeholder="Ask about an event..."
              maxLength={1200}
              rows={2}
              value={draft}
              onChange={(change) => setDraft(change.target.value)}
              disabled={loading}
            />
            <button type="submit" disabled={loading || !draft.trim()} aria-label="Send message">Send</button>
          </form>
          <p className="chat-disclaimer">Event details are based on current listings. Book through the event page.</p>
        </section>
      )}
      <button
        type="button"
        className="chat-launcher"
        aria-expanded={open}
        aria-label={open ? "Close event assistant" : "Open event assistant"}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">{open ? "×" : "✦"}</span>
        {open ? "Close" : "Ask Gather"}
      </button>
    </div>
  );
}
