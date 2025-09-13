# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WhatsApp B2B AI Sales Assistant using OpenAI Swarm Multi-Agent system. The system processes WhatsApp messages through specialized agents for product search, sales, and order management.

## Common Commands

### Development
```bash
# Start all services
start_services.bat

# Individual services
python src/core/swarm_b2b_system.py  # Swarm AI system (port 3007)
node src/core/whatsapp-webhook-sender.js  # WhatsApp bot (port 3001)
node src/core/product-list-server-v2.js  # Product server (port 3005)

# Test API
curl -X POST http://localhost:3007/process-message -H "Content-Type: application/json" -d '{"userId": "test", "whatsapp_number": "905306897885", "message": "test message"}'
```

### Database
```bash
# Create database
psql -U postgres -c "CREATE DATABASE eticaret_db;"

# Run migrations
psql -U postgres -d eticaret_db -f migrations/001_create_order_tables.sql
psql -U postgres -d eticaret_db -f migrations/002_remove_cart_system.sql
psql -U postgres -d eticaret_db -f migrations/003_valve_bul_extras.sql
```

## Architecture

### Multi-Agent System (5 Agents)
1. **Intent Analyzer** - Routes messages to appropriate specialists
2. **Customer Manager** - Handles greetings and customer info
3. **Product Specialist** - Product search and filtering
4. **Sales Expert** - Sales support and pricing
5. **Order Manager** - Order processing and management

### Key Components
- **Swarm System** (Python/Flask, port 3007) - OpenAI Swarm multi-agent orchestrator
- **WhatsApp Bot** (Node.js, port 3001) - Message handling and reply sending
- **Product Server** (Node.js, port 3005) - Dynamic product listing with HTML generation
- **PostgreSQL** - Product catalog and order storage

### Agent Communication Flow
- WhatsApp message → Intent Analyzer → Specialist Agent → Response
- Agents can transfer between each other using functions like `transfer_to_product_specialist()`
- Turkish language support throughout the system

### Important Notes
- Uses OpenRouter API key for GPT model access
- Turkish character encoding may cause issues with curl (use simple Turkish text)
- Product search supports valve/cylinder parameters (diameter, stroke, length)
- Orders are stored with status tracking
- Product pages are generated dynamically in `/product-pages/` directory