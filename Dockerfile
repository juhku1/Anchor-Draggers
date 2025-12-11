FROM python:3.11-slim

WORKDIR /app

# Install dependencies
RUN pip install --no-cache-dir requests

# Copy collection script
COPY collect_ais.py .

# Create data directory
RUN mkdir -p data/ais

# Run collection
CMD ["python", "collect_ais.py"]
