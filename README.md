# SpendTracker

A **zero-server, privacy-first** credit card statement analyzer that runs entirely in your browser.

Upload your PDF or CSV statement and get instant spending insights with charts, categorization, and tagging.

## Features

- **PDF Parsing** - Automatically extracts transactions from most Indian bank credit card statements (PDF.js)
- **Spending Dashboard** - Summary cards showing total spent, received back, net spend, avg monthly
- **4 Interactive Charts** - Monthly trend, category breakdown, spent vs received, top merchants
- **Smart Categorization** - Auto-detects categories (Food, Travel, Shopping, Fuel, etc.)
- **Transaction Tagging** - Mark transactions as "Paid for Relative", "Paid for Friend", or "Self"
- **Notes** - Add personal notes to any transaction
- **Big Transactions** - Highlights large spends with configurable threshold
- **Search & Filter** - Filter by month, tag, or search by text
- **CSV Export** - Export filtered data for use in Excel/Sheets
- **Privacy First** - All data stays in your browser. Nothing is uploaded anywhere.
- **Persistent Tags** - Tags and notes are saved in localStorage across sessions

## Quick Start

1. Clone or download this repository
2. Open `index.html` in any modern browser
3. Drop your credit card PDF statement(s) — multiple files supported
4. Explore your spending patterns!

**No installation, no server, no dependencies to install.**

## Supported Formats

| Format | Bank | Status |
|--------|------|--------|
| PDF | ICICI, HDFC, SBI, Axis, Kotak, AMEX & more | Supported |
| CSV | Generic (Date, Description, Amount) | Supported |

## How to Use

### Upload
- Drag & drop your PDF statement onto the upload zone
- Or click "Choose File" to browse

### Tag Transactions
- Click the pencil icon next to any transaction
- Select a tag (Relative / Friend / Self)
- Add an optional note
- Tags persist in your browser's localStorage

### Export
- Use the "Export CSV" button to download your filtered data
- Open in Excel or Google Sheets for further analysis

## Deploy on GitHub Pages

1. Fork this repo
2. Go to Settings > Pages
3. Set source to "main" branch, root folder
4. Your app is live at `https://yourusername.github.io/SpendTracker/`

## Tech Stack

- **PDF.js** v3.11.174 - Client-side PDF parsing
- **Chart.js** v4.4.0 - Beautiful responsive charts
- **Vanilla JS** - No frameworks, no build step
- **LocalStorage** - Persistent tag/note storage

## Project Structure

```
SpendTracker/
├── index.html       # Main application page
├── css/
│   └── style.css    # All styling
├── js/
│   ├── parser.js    # PDF extraction & bank-agnostic format parsing
│   └── app.js       # Dashboard, charts, filters, tagging
└── README.md        # This file
```

## Contributing

1. Fork the repo
2. Add support for your bank's statement format in `parser.js`
3. Submit a PR

## License

MIT - Use freely for personal or commercial purposes.
