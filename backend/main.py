from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from groq import Groq
from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, firestore 
import os
import tempfile

# --- NEW RAG IMPORTS ---
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_community.vectorstores import FAISS

load_dotenv()

# 1. Initialize Firebase
cred = credentials.Certificate("firebase-credentials.json")
# Prevent initializing multiple times if code hot-reloads
if not firebase_admin._apps:
    firebase_admin.initialize_app(cred)
db = firestore.client()

app = FastAPI()

# 2. Allow React (Frontend) to communicate with FastAPI (Backend)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173"
    ], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class QueryRequest(BaseModel):
    query: str

# --- NEW: Initialize RAG Components ---
# We use a free, local embedding model from HuggingFace to convert text to vectors
embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
vector_store = None  # This will store our uploaded document vectors in memory

@app.post("/upload")
async def upload_document(file: UploadFile = File(...)):
    """Endpoint to upload a PDF, extract text, and add it to our Vector Store."""
    global vector_store
    
    # Save the uploaded file temporarily
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    # Load and split the PDF
    loader = PyPDFLoader(tmp_path)
    docs = loader.load()
    
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
    splits = text_splitter.split_documents(docs)

    # Add to FAISS vector store
    if vector_store is None:
        vector_store = FAISS.from_documents(splits, embeddings)
    else:
        vector_store.add_documents(splits)

    # Cleanup temporary file
    os.remove(tmp_path)
    
    return {"message": f"Successfully processed and embedded {file.filename}"}


@app.post("/chat")
async def chat_endpoint(request: QueryRequest):
    query = request.query.lower()
    
    # 3. Check Firebase for a cached answer
    cache_ref = db.collection("aura_cache")
    query_results = cache_ref.where("query", "==", query).stream()
    
    local_answer = None
    doc_id = None
    
    for doc in query_results:
        local_answer = doc.to_dict().get("answer")
        doc_id = doc.id
        break

    # --- NEW: Retrieve Context from Documents (RAG) ---
    context = ""
    if vector_store is not None:
        # Search the vector store for the top 3 most relevant chunks to the query
        relevant_docs = vector_store.similarity_search(query, k=3)
        context = "\n\n".join([doc.page_content for doc in relevant_docs])

    # Construct an augmented prompt if we have context
    if context:
        augmented_prompt = f"""Use the following context to answer the question. If the context doesn't contain the answer, use your general knowledge.
        
Context:
{context}

Question:
{query}"""
    else:
        augmented_prompt = query

    # 4. Fetch a fresh answer from Groq (Now Augmented with Document Context)
    req1 = Groq(api_key=os.getenv("api_request"))
    req2 = Groq(api_key=os.getenv("api_compare"))
    
    resp = req1.chat.completions.create(
        model="openai/gpt-oss-120b", 
        messages=[{"role": "user", "content": augmented_prompt}]
    )
    google_answer = resp.choices[0].message.content

    # 5. The AI Evaluator Logic (Unchanged)
    if local_answer:
        compare_prompt = f"""You are an AI evaluator.
Compare the following two answers.
QUESTION:
{query}
ANSWER 1 (Local Database):
{local_answer}
ANSWER 2 (Google Gemini):
{google_answer}
Tasks:
1. Which answer is more accurate?
2. Which answer is more complete?
3. Which answer is easier to understand?
4. Final winner: {local_answer} or {google_answer}

Rules:
- Return only the final best answer.
- Response should feel natural, direct, and human-like.
- Do not explain how the answer was selected.
- Do not mention multiple answers existed.
- Keep the response concise but complete.
- If code is involved, provide the most optimized and correct version only.
"""
        judge = req2.chat.completions.create(
            model="openai/gpt-oss-20b", 
            messages=[{"role": "user", "content": compare_prompt}]
        )
        result = judge.choices[0].message.content
        
        # If the new answer is better, update Firebase
        cache_ref.document(doc_id).update({"answer": result})
        return {"answer": result}
            
    else:
        # 6. Save new query to Firebase if it doesn't exist
        cache_ref.add({
            "query": query,
            "answer": google_answer
        })
        return {"answer": google_answer}