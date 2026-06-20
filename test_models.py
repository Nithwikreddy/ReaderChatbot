import os
from google import genai
from google.genai import errors

gemini_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")

if not gemini_key:
    print("Error: GEMINI_API_KEY environment variable is not set.")
    exit(1)

print(f"Testing API key starting with: {gemini_key[:10]}...")

try:
    # Initialize the official Google GenAI client
    client = genai.Client(api_key=gemini_key)
    
    print("\nAttempting to list models...")
    response = client.models.list()
    
    print("\nSuccess! Here are the embedding models you have access to:")
    found_any = False
    for model in response:
        if 'embedContent' in model.supported_actions:
            print(f" - {model.name}")
            found_any = True
            
    if not found_any:
        print("No embedding models found! This API key might have embedding actions restricted.")
        
except errors.APIError as e:
    print(f"\nAPI Error occurred: {e}")
except Exception as e:
    print(f"\nAn unexpected error occurred: {e}")
