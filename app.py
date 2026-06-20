import os
import sys
import io
from dotenv import load_dotenv

# Load env variables from .env
load_dotenv()

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from pypdf import PdfReader

# Imports from LangChain
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnablePassthrough
from langchain_core.output_parsers import StrOutputParser
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import DocArrayInMemorySearch

app = FastAPI(title="Apex PDF Q&A Bot")

# App Global State
api_provider = None
model = None
embeddings = None
vectorstore = None
retriever = None
rag_chain = None
document_loaded = False
document_name = None

def init_models():
    """Initializes embeddings and chat models based on environment variables."""
    global model, embeddings, api_provider
    
    gemini_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    openai_key = os.environ.get("OPENAI_API_KEY")
    
    if gemini_key:
        api_provider = "gemini"
        from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings
        # Use gemini-2.5-flash as in rag_bot.py
        model = ChatGoogleGenerativeAI(model="gemini-2.5-flash", temperature=0)
        embeddings = GoogleGenerativeAIEmbeddings(model="models/gemini-embedding-2")
    elif openai_key:
        api_provider = "openai"
        from langchain_openai import ChatOpenAI, OpenAIEmbeddings
        model = ChatOpenAI(model="gpt-4o-mini", temperature=0)
        embeddings = OpenAIEmbeddings()
    else:
        api_provider = None
        model = None
        embeddings = None

# Initialize on startup
init_models()

class QueryRequest(BaseModel):
    question: str

@app.get("/status")
async def get_status():
    """Returns the initialization and document loading status."""
    # Re-initialize models in case keys were set after app startup
    init_models()
    
    return {
        "api_provider": api_provider,
        "has_api_key": api_provider is not None,
        "document_loaded": document_loaded,
        "document_name": document_name
    }

@app.post("/upload")
async def upload_pdf(file: UploadFile = File(...)):
    """Receives a PDF file, parses it, chunks the text, and stores embeddings in a vector database."""
    global vectorstore, retriever, rag_chain, document_loaded, document_name
    
    # 1. Validate file format
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")
        
    # 2. Check API Key
    init_models()
    if not api_provider or not model or not embeddings:
        raise HTTPException(
            status_code=400, 
            detail="No API Key found. Please set GEMINI_API_KEY or OPENAI_API_KEY in the environment where the server is running."
        )
        
    try:
        # 3. Read and parse the PDF in memory
        pdf_bytes = await file.read()
        pdf_file = io.BytesIO(pdf_bytes)
        reader = PdfReader(pdf_file)
        
        text = ""
        for page in reader.pages:
            page_text = page.extract_text()
            if page_text:
                text += page_text + "\n"
                
        if not text.strip():
            raise HTTPException(
                status_code=400, 
                detail="The PDF file does not contain any readable text. Scanned images are not supported."
            )
            
        # 4. Split text into chunks
        text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
        docs = text_splitter.create_documents([text])
        
        if not docs:
            raise HTTPException(status_code=400, detail="Failed to create text chunks from the PDF.")
            
        # 5. Index document chunks in DocArrayInMemorySearch
        vectorstore = DocArrayInMemorySearch.from_documents(docs, embedding=embeddings)
        retriever = vectorstore.as_retriever(search_kwargs={"k": 3})
        
        # 6. Re-create the prompt template and pipeline
        prompt_template = """You are a helpful document assistant. 
Answer the user's question using ONLY the provided context. If you do not know the answer from the context, say "I couldn't find that information in the notes."

Context:
{context}

Question: {question}

Answer:"""
        prompt = ChatPromptTemplate.from_template(prompt_template)
        
        rag_chain = (
            {"context": retriever, "question": RunnablePassthrough()}
            | prompt
            | model
            | StrOutputParser()
        )
        
        document_loaded = True
        document_name = file.filename
        
        return {
            "status": "success",
            "message": f"Successfully parsed and indexed {len(docs)} chunks from '{file.filename}'."
        }
        
    except HTTPException as he:
        raise he
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500, 
            detail=f"An error occurred while processing the PDF file: {str(e)}"
        )

@app.post("/query")
async def query_document(request: QueryRequest):
    """Processes user query against the loaded document context using the RAG chain."""
    global rag_chain, document_loaded
    
    if not document_loaded or not rag_chain:
        raise HTTPException(
            status_code=400, 
            detail="No document has been loaded yet. Please upload a PDF first."
        )
        
    if not request.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty.")
        
    try:
        response = rag_chain.invoke(request.question)
        return {"answer": response}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500, 
            detail=f"An error occurred during query execution: {str(e)}"
        )

@app.post("/reset")
async def reset_document():
    """Resets the vector index and document loading state in memory."""
    global vectorstore, retriever, rag_chain, document_loaded, document_name
    vectorstore = None
    retriever = None
    rag_chain = None
    document_loaded = False
    document_name = None
    return {"status": "success", "message": "Document successfully cleared and state reset."}

# Serve index.html at root
@app.get("/")
async def get_index():
    # Make sure file exists before serving, otherwise return 404
    index_path = os.path.join("static", "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"detail": "Frontend index.html not found. Make sure the static folder is populated."}

# Mount static files directory
# Note: Mount this after custom routes to ensure standard route routing takes precedence
if not os.path.exists("static"):
    os.makedirs("static")
app.mount("/static", StaticFiles(directory="static"), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
