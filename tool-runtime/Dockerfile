FROM python:3.13-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends libreoffice-writer fonts-liberation && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir python-docx==1.2.0 pypdf==6.19.0 pypdfium2==5.13.0
COPY vendor /opt/glashaus/vendor
COPY render.py collect.py /opt/glashaus/
ENV PYTHONDONTWRITEBYTECODE=1 HOME=/tmp
USER 1000:1000
WORKDIR /work
CMD ["sleep", "infinity"]
