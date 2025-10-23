# QueryAndAnswer - Claude Code Configuration

## 🎯 Project Purpose

**QueryAndAnswer** is an intelligent WhatsApp B2B AI Assistant system that transforms natural language queries into accurate, contextual answers using OpenAI Swarm architecture.

**Core Mission**: Every query deserves an intelligent answer. Every user deserves a seamless experience.

---

## 🏗️ System Architecture

### Technology Stack
- **Backend**: Python 3.8+ & Node.js 16+
- **AI Framework**: OpenAI Swarm (5-agent orchestration)
- **AI Model**: OpenRouter (GPT-4.1-nano)
- **Database**: PostgreSQL 12+
- **WhatsApp**: whatsapp-web.js
- **Web Server**: Express.js

### Active Services
- **Port 3001**: WhatsApp Webhook Server
- **Port 3005**: Product Server (Dynamic HTML generation)
- **Port 3007**: Swarm AI System (Multi-agent orchestration)

---

## 🤖 Agent Architecture

### 5-Agent System (OpenAI Swarm)

1. **Intent Analyzer** - Message routing & query classification
2. **Customer Manager** - Customer relations & general support
3. **Product Specialist** - Technical product search & recommendations
4. **Sales Expert** - Pricing & sales support
5. **Order Manager** - Order processing & fulfillment

### Agent Communication Flow
```
WhatsApp Query → Intent Analyzer → Specialist Agent → Database → Answer Generation → WhatsApp Response
```

---

## 📁 Project Structure

```
QueryAndAnswer/
├── src/core/
│   ├── whatsapp-webhook-sender.js    # WhatsApp integration
│   ├── swarm_b2b_system.py           # AI orchestration
│   ├── product-list-server-v2.js     # Product catalog & HTML
│   └── ...
├── migrations/                        # Database migrations
├── product-pages/                     # Dynamic HTML (auto-generated)
├── HANDOFF.md                         # 📖 Complete project documentation
└── .claude/                           # Claude Code configuration
```

---

## ⚙️ Configuration

### Environment Variables (.env)
```env
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_MODEL=openai/gpt-4.1-nano
WHATSAPP_PHONE=905306897885
REPLY_SERVER_PORT=3001
SWARM_SERVER_PORT=3007
PRODUCT_SERVER_PORT=3005
DB_HOST=localhost
DB_PORT=5432
DB_NAME=eticaret_db
DB_USER=postgres
DB_PASSWORD=your_password
```

### Quick Start
```bash
# Install dependencies
pip install -r requirements.txt
npm install

# Setup database
psql -U postgres -d eticaret_db -f migrations/001_create_order_tables.sql

# Start services
start_services.bat
```

---

## 🎯 Current Project Status

**System Status**: ✅ ALL SYSTEMS OPERATIONAL

### Working Features
- ✅ WhatsApp message handling (send/receive)
- ✅ 5-agent conversation flow
- ✅ Parametric product search (diameter, stroke, series)
- ✅ Dynamic HTML page generation
- ✅ Token-based secure access
- ✅ Order processing & tracking
- ✅ Agent transfer mechanism

### Recent Optimizations
- ✅ CloudFlare tunnel 502 fix
- ✅ Duplicate message prevention
- ✅ Direct order system (cart removed)
- ✅ Token-based security system

---

## 📚 Important Documentation

### Primary Reference
- **HANDOFF.md** - Complete project documentation (START HERE!)

### Code Style
- Python: PEP 8
- JavaScript: ESLint + Prettier
- Git Commits: Conventional Commits

### Testing Endpoints
```bash
# Test Swarm AI
curl -X POST http://localhost:3007/process-message \
  -H "Content-Type: application/json" \
  -d '{"message": "100x200 silindir", "whatsapp_number": "test@c.us"}'

# Health checks
curl http://localhost:3001/health  # WhatsApp
curl http://localhost:3005/health  # Product Server
```

---

## 🚀 Development Workflow

### Adding New Features
1. Read `HANDOFF.md` for full context
2. Create feature branch: `git checkout -b feature/new-capability`
3. Implement changes
4. Test thoroughly
5. Commit with conventional format: `feat: Add new capability`
6. Push and create PR

### Key Files to Modify
- **Agent Logic**: `src/core/swarm_b2b_system.py`
- **WhatsApp Integration**: `src/core/whatsapp-webhook-sender.js`
- **Product Features**: `src/core/product-list-server-v2.js`
- **Database**: `migrations/*.sql`

---

## ⚠️ Critical Notes

### Security
- Never commit API keys
- Protect .env file
- Keep WhatsApp session files backed up

### System Requirements
- Node.js v16+
- Python 3.8+
- PostgreSQL 12+
- 4GB RAM minimum

### Performance Targets
- Response time: <2 seconds
- System uptime: >99.9%
- Accuracy: >95%

---

## 📖 Learning Resources

### Must Read
1. **HANDOFF.md** - Complete project documentation
2. OpenAI Swarm: https://github.com/openai/swarm
3. whatsapp-web.js: https://wwebjs.dev/

### Architecture Patterns
- Multi-agent systems
- Microservices communication
- Event-driven architecture
- Token-based security

---

**Last Updated**: 2025-10-23
**Repository**: https://github.com/Bahadir67/QueryAndAnswer

🚀 **Welcome to QueryAndAnswer!**
