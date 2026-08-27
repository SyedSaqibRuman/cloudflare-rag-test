import { read_file, write_file } from hermes_tools

content = await read_file("/home/syed/Desktop/web-dev/cloudflare-rag-test/ingest/__tests__/ingestion-v5.test.js")

# Fix all import paths from "../adapters/" to "../../mysql/adapters/"
content = content.replace(/from "\.\.\/adapters\//g, 'from "../../mysql/adapters/')
content = content.replace(/from "\.\.\/mysql\/services\//g, 'from "../../mysql/services/')
content = content.replace(/from "\.\.\/utils\//g, 'from "../../utils/')
content = content.replace(/from "\.\.\/pipeline\.js"/g, 'from "../pipeline.js"')
content = content.replace(/from "\.\.\/registry\.js"/g, 'from "../registry.js"')

await write_file("/home/syed/Desktop/web-dev/cloudflare-rag-test/ingest/__tests__/ingestion-v5.test.js", content)
print("Fixed import paths")