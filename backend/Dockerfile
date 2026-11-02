FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DJANGO_DEBUG=false \
    DATA_DIR=/data \
    FFMPEG_BIN=/usr/bin/ffmpeg

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .
RUN chmod +x start.sh \
    && DJANGO_SECRET_KEY=collectstatic-only python manage.py collectstatic --noinput

EXPOSE 8000
CMD ["./start.sh"]
