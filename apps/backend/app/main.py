from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .core.config import settings
from .routers import router

app = FastAPI(title="PFM Backend", version="0.1.0")

# CORS (프론트엔드 연결 준비)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,  # 개발 편의. 운영에서는 도메인 제한 권장
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=[
        "X-Total-Count",
        "X-Duplicate-Transfers",
        "X-Settlement-Duplicates",
        "X-DB-Transfer-Matches",
        "X-Existing-Duplicates",
        "X-Natural-Duplicates",
    ],
)


@app.get("/health")
def health():
    return {"status": "ok"}


app.include_router(router, prefix="/api")
