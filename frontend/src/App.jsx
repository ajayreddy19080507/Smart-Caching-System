import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import './App.css'

function App() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  
  // --- NEW: File Upload State ---
  const [selectedFile, setSelectedFile] = useState(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState('')

  const messagesEndRef = useRef(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // --- NEW: File Upload Handlers ---
  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFile(e.target.files[0])
      setUploadStatus('') // Reset status when a new file is picked
    }
  }

  const handleUpload = async () => {
    if (!selectedFile) return

    setIsUploading(true)
    setUploadStatus('Uploading...')

    const formData = new FormData()
    formData.append('file', selectedFile)

    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000'
      
      // Note: We don't set 'Content-Type' manually for FormData. 
      // The browser automatically sets it to 'multipart/form-data' with the correct boundary.
      const response = await fetch(`${backendUrl}/upload`, {
        method: 'POST',
        body: formData,
      })

      if (response.ok) {
        const data = await response.json()
        setUploadStatus('✅ ' + data.message)
        setSelectedFile(null) // clear selection after success
        
        // Optional: clear the file input field visually
        document.getElementById('pdf-upload').value = '' 
      } else {
        setUploadStatus('❌ Upload failed.')
      }
    } catch (error) {
      console.error("Upload Error:", error)
      setUploadStatus('❌ Error connecting to backend.')
    } finally {
      setIsUploading(false)
    }
  }

  const handleSend = async (e) => {
    e.preventDefault()
    if (!input.trim()) return

    const userMessage = { role: 'user', content: input }
    setMessages(prev => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000'
      
      const response = await fetch(`${backendUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: input })
      })
      const data = await response.json()
      
      const botMessage = { role: 'bot', content: data.answer }
      setMessages(prev => [...prev, botMessage])
    } catch (error) {
      console.error("Backend Error:", error)
      setMessages(prev => [...prev, { role: 'bot', content: "Waiting for backend to connect..." }])
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="app-container">
      <div className="glass-panel">
        <header className="header">
          <h2>Smart Caching System</h2>
          
          {/* --- NEW: Upload UI integrated into the header area --- */}
          <div className="upload-container" style={{ marginTop: '10px', padding: '10px', background: 'rgba(255,255,255,0.1)', borderRadius: '8px' }}>
            <input 
              id="pdf-upload"
              type="file" 
              accept=".pdf" 
              onChange={handleFileChange}
              disabled={isUploading}
              style={{ fontSize: '14px' }}
            />
            <button 
              onClick={handleUpload} 
              disabled={!selectedFile || isUploading}
              style={{ marginLeft: '10px', cursor: (!selectedFile || isUploading) ? 'not-allowed' : 'pointer' }}
            >
              {isUploading ? 'Uploading...' : 'Upload Context (PDF)'}
            </button>
            {uploadStatus && (
              <p style={{ margin: '5px 0 0 0', fontSize: '12px', color: '#e0e0e0' }}>
                {uploadStatus}
              </p>
            )}
          </div>
        </header>

        <div className="chat-box">
          {messages.length === 0 && (
            <div className="message-row bot">
              <div className="bubble bot">
                Hello! I am your self-refining AI. Upload a PDF context document above, or just ask me anything!
              </div>
            </div>
          )}
          
          {messages.map((msg, idx) => (
            <div key={idx} className={`message-row ${msg.role}`}>
              <div className={`bubble ${msg.role}`}>
                {msg.role === 'bot' ? (
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                ) : (
                  msg.content
                )}
              </div>
            </div>
          ))}
          
          {isLoading && (
            <div className="message-row bot">
              <div className="bubble bot typing">Thinking...</div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={handleSend} className="input-form">
          <input 
            type="text" 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your query..."
            disabled={isLoading}
          />
          <button type="submit" disabled={isLoading || !input.trim()}>
            Send
          </button>
        </form>
      </div>
    </div>
  )
}

export default App