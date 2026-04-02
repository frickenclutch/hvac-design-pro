from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

class CalculationRequest(BaseModel):
    a: float
    b: float

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/calculate")
def calculate(request: CalculationRequest):
    return {"result": request.a + request.b}
