import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from app.config import settings

engine = create_async_engine(
    settings.database_url,
    echo=settings.debug,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db():
    from app.models import document, job  # noqa: F401

    # Retry connecting until Postgres is ready
    for attempt in range(1, 11):
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            print("Database tables created successfully")
            return
        except Exception as e:
            print(f"Database not ready (attempt {attempt}/10): {e}")
            if attempt == 10:
                raise
            await asyncio.sleep(3)