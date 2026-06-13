/**
 * SpendTracker - PDF Statement Parser
 * Bank-agnostic credit card statement parser
 * Supports: ICICI, HDFC, SBI, Axis, Kotak, AMEX, and most Indian bank formats
 */

class StatementParser {
    constructor() {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        // Date patterns supported (order matters - most specific first)
        this.datePatterns = [
            // DD-MMM-YY or DD-MMM-YYYY (ICICI, AMEX): 15-JAN-25, 15-JAN-2025
            { regex: /(\d{2})-(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)-(\d{2,4})/i, type: 'dmy-alpha' },
            // DD/MM/YYYY (HDFC, SBI, Axis): 15/01/2025
            { regex: /(\d{2})\/(\d{2})\/(\d{4})/, type: 'dmy-slash' },
            // DD-MM-YYYY (Kotak, some HDFC): 15-01-2025
            { regex: /(\d{2})-(\d{2})-(\d{4})/, type: 'dmy-dash' },
            // DD/MM/YY: 15/01/25
            { regex: /(\d{2})\/(\d{2})\/(\d{2})/, type: 'dmy-slash-short' },
            // MM/DD/YYYY (AMEX intl): 01/15/2025
            { regex: /(\d{2})\/(\d{2})\/(\d{4})/, type: 'mdy-slash' },
        ];
        this.monthMap = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
    }

    async parsePDF(file) {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        
        let allText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            const strings = content.items.map(item => item.str);
            allText += strings.join(' ') + '\n';
        }

        return this.parseStatementText(allText);
    }

    parseStatementText(text) {
        const transactions = [];
        const fullText = text.replace(/\n/g, ' ');

        // Auto-detect which date format this statement uses
        const formatCounts = {
            'dmy-alpha': (fullText.match(/\d{2}-(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)-\d{2,4}/gi) || []).length,
            'dmy-slash': (fullText.match(/\d{2}\/\d{2}\/\d{4}/g) || []).length,
            'dmy-dash': (fullText.match(/\d{2}-\d{2}-\d{4}/g) || []).length,
            'dmy-slash-short': (fullText.match(/\d{2}\/\d{2}\/\d{2}(?!\d)/g) || []).length,
        };

        // Pick the format with most matches
        const detectedFormat = Object.entries(formatCounts).sort((a, b) => b[1] - a[1])[0];
        this.activeFormat = detectedFormat[0];

        // Build split regex based on detected format
        let splitRegex;
        if (this.activeFormat === 'dmy-alpha') {
            splitRegex = /(?=\d{2}-(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)-\d{2,4})/gi;
        } else if (this.activeFormat === 'dmy-slash') {
            splitRegex = /(?=\d{2}\/\d{2}\/\d{4})/g;
        } else if (this.activeFormat === 'dmy-dash') {
            splitRegex = /(?=\d{2}-\d{2}-\d{4})/g;
        } else {
            splitRegex = /(?=\d{2}\/\d{2}\/\d{2}(?!\d))/g;
        }

        const segments = fullText.split(splitRegex);
        
        for (const segment of segments) {
            const txn = this.parseTransactionSegment(segment.trim());
            if (txn) {
                transactions.push(txn);
            }
        }

        return transactions;
    }

    parseTransactionSegment(segment) {
        if (!segment || segment.length < 10) return null;

        let day, month, year, date, dateStr, dateLen;

        // Try DD-MMM-YY or DD-MMM-YYYY
        let dateMatch = segment.match(/^(\d{2})-(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)-(\d{2,4})/i);
        if (dateMatch) {
            day = dateMatch[1];
            const monthAlpha = dateMatch[2].toUpperCase();
            month = this.monthMap[monthAlpha];
            year = dateMatch[3];
            const fullYear = year.length === 4 ? parseInt(year) : (parseInt(year) > 50 ? 1900 + parseInt(year) : 2000 + parseInt(year));
            date = new Date(fullYear, month, parseInt(day));
            dateStr = `${day}-${monthAlpha}-${String(fullYear).slice(-2)}`;
            dateLen = dateMatch[0].length;
        }

        // Try DD/MM/YYYY
        if (!dateMatch) {
            dateMatch = segment.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
            if (dateMatch) {
                day = dateMatch[1];
                month = parseInt(dateMatch[2]) - 1;
                year = dateMatch[3];
                date = new Date(parseInt(year), month, parseInt(day));
                const monthNames = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
                dateStr = `${day}-${monthNames[month]}-${String(year).slice(-2)}`;
                dateLen = dateMatch[0].length;
            }
        }

        // Try DD-MM-YYYY
        if (!dateMatch) {
            dateMatch = segment.match(/^(\d{2})-(\d{2})-(\d{4})/);
            if (dateMatch) {
                day = dateMatch[1];
                month = parseInt(dateMatch[2]) - 1;
                year = dateMatch[3];
                date = new Date(parseInt(year), month, parseInt(day));
                const monthNames = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
                dateStr = `${day}-${monthNames[month]}-${String(year).slice(-2)}`;
                dateLen = dateMatch[0].length;
            }
        }

        // Try DD/MM/YY
        if (!dateMatch) {
            dateMatch = segment.match(/^(\d{2})\/(\d{2})\/(\d{2})(?!\d)/);
            if (dateMatch) {
                day = dateMatch[1];
                month = parseInt(dateMatch[2]) - 1;
                year = dateMatch[3];
                const fullYear = parseInt(year) > 50 ? 1900 + parseInt(year) : 2000 + parseInt(year);
                date = new Date(fullYear, month, parseInt(day));
                const monthNames = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
                dateStr = `${day}-${monthNames[month]}-${year}`;
                dateLen = dateMatch[0].length;
            }
        }

        if (!dateMatch || isNaN(date.getTime())) return null;

        // Remove date from segment
        let rest = segment.substring(dateLen).trim();

        // Skip header rows and non-transaction content
        if (rest.includes('TRANSACTION DETAILS') || rest.includes('Card Number') || 
            rest.includes('Ref. Number') || rest.includes('category of service') ||
            rest.includes('REGISTERED OFFICE') || rest.includes('Statement Period') ||
            rest.includes('Opening Balance') || rest.includes('Closing Balance') ||
            rest.includes('Payment Due') || rest.includes('Total Due') ||
            rest.includes('Reward Points') || rest.includes('Page ')) {
            return null;
        }

        // Try to extract amount - last number(s) in the line
        // Formats: 1,234.56 or -1,234.56 or Cr 1,234.56 or Dr 1,234.56
        const amountPattern = /(-?[\d,]+\.\d{2})\s*$/;
        const amounts = [];
        
        // Find all potential amounts (numbers with decimals)
        const allAmounts = rest.match(/-?[\d,]+\.\d{2}/g);
        if (!allAmounts || allAmounts.length === 0) return null;

        // The last amount is the INR amount, second-to-last might be international amount
        const inrAmount = parseFloat(allAmounts[allAmounts.length - 1].replace(/,/g, ''));
        
        // Extract reference number (long digit string) - REDACT for PCI DSS
        const refMatch = rest.match(/^(\d{20,30})/);
        let refNumber = '';
        if (refMatch) {
            // Only store last 4 digits of reference number
            refNumber = '****' + refMatch[1].slice(-4);
            rest = rest.substring(refMatch[0].length).trim();
        }

        // Get description - everything between ref/date and amounts
        let description = rest;
        
        // Remove amounts and currency from description
        if (allAmounts.length >= 2) {
            // Find position of second-to-last amount
            const intAmount = allAmounts[allAmounts.length - 2];
            const lastIdx = description.lastIndexOf(allAmounts[allAmounts.length - 1]);
            if (lastIdx > 0) {
                description = description.substring(0, lastIdx).trim();
            }
            // Remove international amount too
            const intIdx = description.lastIndexOf(intAmount);
            if (intIdx > 0 && intIdx > description.length - 20) {
                description = description.substring(0, intIdx).trim();
            }
        } else {
            const lastIdx = description.lastIndexOf(allAmounts[0]);
            if (lastIdx > 0) {
                description = description.substring(0, lastIdx).trim();
            }
        }

        // Remove currency codes
        description = description.replace(/\b(INR|USD|AED|LKR|EUR|GBP)\b\s*/gi, '').trim();
        // Remove trailing "0.00" or amount patterns
        description = description.replace(/\s+0\.00\s*$/, '').trim();
        // Remove "IN" at end (country code)
        description = description.replace(/\s+IN\s*$/, '').trim();
        // Remove asterisks
        description = description.replace(/\*+/g, '').trim();
        // PCI DSS: Mask any card numbers (13-19 digit sequences)
        description = description.replace(/\b(\d{4})\d{5,11}(\d{4})\b/g, '$1****$2');
        // Mask 4-digit card suffixes shown as XX1234
        description = description.replace(/\bXX(\d{4})\b/gi, 'XX****');

        // PII Redaction
        description = this.redactPII(description);

        // Skip if description is empty or too short
        if (!description || description.length < 2) return null;
        // Skip if this looks like a header
        if (description.includes('International amount') || description.includes('Amount(in')) return null;

        // Detect currency
        let currency = 'INR';
        const currencyMatch = segment.match(/\b(USD|AED|LKR|EUR|GBP)\b/i);
        if (currencyMatch) {
            currency = currencyMatch[1].toUpperCase();
        }

        // Detect Cr/Dr indicator (HDFC, SBI, Axis use this)
        let isCredit = inrAmount < 0;
        if (/\bCr\.?\s*$/i.test(rest) || /\bCR\s*$/i.test(rest)) {
            isCredit = true;
        }
        if (/\bDr\.?\s*$/i.test(rest)) {
            isCredit = false;
        }

        return {
            id: this.generateId(),
            date: date,
            dateStr: dateStr,
            refNumber: refNumber,
            description: this.cleanDescription(description),
            amount: Math.abs(inrAmount),
            currency: currency,
            isCredit: isCredit,
            tag: '',
            note: ''
        };
    }

    cleanDescription(desc) {
        // Clean up common patterns
        desc = desc.replace(/\s+/g, ' ').trim();
        desc = desc.replace(/^[\d\s]+/, '').trim(); // Remove leading numbers
        desc = desc.replace(/httpswww\w+/gi, '').trim();
        desc = desc.replace(/wwwamazonin/gi, '').trim();
        desc = desc.replace(/httpchowma/gi, '').trim();
        desc = desc.replace(/httpswwwz/gi, '').trim();
        desc = desc.replace(/httpswwwc/gi, '').trim();
        desc = desc.replace(/httpswwwt/gi, '').trim();
        desc = desc.replace(/httpwwwli/gi, '').trim();
        desc = desc.replace(/httpsshoff/gi, '').trim();
        desc = desc.replace(/httpshaldi/gi, '').trim();
        desc = desc.replace(/www\.irctctour/gi, '').trim();
        desc = desc.replace(/wwwlinkedin/gi, '').trim();
        desc = desc.replace(/wwwamazonin/gi, '').trim();
        // Final PII pass on cleaned description
        desc = this.redactPII(desc);
        // Cap length
        if (desc.length > 60) desc = desc.substring(0, 60) + '...';
        return desc;
    }

    redactPII(text) {
        // Bank account numbers (4-18 digits after keywords like Acc, A/c, Account)
        text = text.replace(/\b(Acc|A\/c|Account|Acct)\s*[#:]?\s*\w{0,2}(\d{4,})\b/gi, (m, prefix) => prefix + ' ****');
        
        // Indian PAN number (ABCDE1234F format)
        text = text.replace(/\b[A-Z]{5}\d{4}[A-Z]\b/g, '[PAN REDACTED]');
        
        // Aadhaar number (12 digits, often written as XXXX XXXX XXXX)
        text = text.replace(/\b\d{4}\s?\d{4}\s?\d{4}\b/g, (match) => {
            // Only redact if it looks like Aadhaar (not amounts or dates)
            if (match.replace(/\s/g, '').length === 12) return '[ID REDACTED]';
            return match;
        });
        
        // Phone numbers - Indian (10 digits starting with 6-9)
        text = text.replace(/\b[6-9]\d{9}\b/g, '[PHONE REDACTED]');
        // Phone with country code
        text = text.replace(/\+91[\s-]?\d{10}\b/g, '[PHONE REDACTED]');
        
        // Email addresses
        text = text.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL REDACTED]');
        
        // UPI IDs (name@bank)
        text = text.replace(/[a-zA-Z0-9._-]+@[a-zA-Z]{2,10}\b/g, (match) => {
            // Don't redact if it looks like an email (already handled above)
            if (match.includes('.')) return match;
            return '[UPI REDACTED]';
        });
        
        // IFSC codes (4 letters + 0 + 6 alphanumeric)
        text = text.replace(/\b[A-Z]{4}0[A-Z0-9]{6}\b/g, '[IFSC REDACTED]');
        
        // Generic long digit sequences (potential account/ID numbers) - 10+ digits not already handled
        text = text.replace(/\b\d{10,18}\b/g, (match) => '****' + match.slice(-4));
        
        return text;
    }

    generateId() {
        return 'txn_' + Math.random().toString(36).substring(2, 11);
    }

    categorize(description) {
        const desc = description.toUpperCase();
        
        const categories = {
            'Food & Dining': ['ZOMATO', 'SWIGGY', 'BLINKIT', 'ZEPTO', 'MC DONALD', 'STARBUCKS', 'CHAAYOS', 'DOMINO', 'KFC', 'PIZZA', 'CAFE', 'RESTAURANT', 'FOOD', 'BAKERY', 'KITCHEN', 'BIRYANI', 'CHOWMAN', 'EAZYDINER', 'BOOKMYSHOW', 'PVR', 'CINEPOLIS', 'INSTAMART', 'RAMESHWARAM', 'MANOHAR DAIRY', 'COUNTRYSIDE', 'LAVONNE', 'TOSCANO', 'PERIODIC TABLE'],
            'Travel': ['INDIGO', 'AIR INDIA', 'MAKEMYTRIP', 'CLEARTRIP', 'ETIHAD', 'UBER', 'OLA', 'IRCTC', 'AIRBNB', 'HOTEL', 'KINGSBURY', 'RADISSON', 'HELICOPTER', 'SMVD', 'DREAMFOLKS'],
            'Shopping': ['AMAZON', 'FLIPKART', 'MYNTRA', 'ZARA', 'H&M', 'HENNES', 'WESTSIDE', 'ZUDIO', 'RELIANCE', 'LIFESTYLE', 'RARE RABBIT', 'NIKE', 'BATA', 'FABINDIA', 'SAMYAKK', 'TITAN', 'LENSKART', 'SUNGLASS', 'FOREST ESSENTIAL', 'NYKAA', 'SNITCH', 'SABYASACHI', 'RAYMOND', 'CHANEL', 'MALABAR GOLD', 'SPARKLE GOLD', 'BLUESTONE', 'ANAND JEWELS', 'ZIMSON'],
            'Groceries': ['INNOVATIVE RETAIL', 'RSPBLINK', 'BLINKIT', 'BIGBASKET', 'RANA RAMDEV', 'TOP IN TOWN', 'LOYAL WORLD', 'SOWPARNIKA', 'CARGILLS'],
            'Fuel': ['FUEL', 'PETROL', 'BPCL', 'SHELL', 'FILLING STATION', 'PKV FILLING', 'RELIANCE BP', 'ADNOC', 'MATS FUEL', 'V V R FUELS', 'POURNAMI FUEL'],
            'Health & Beauty': ['PHARMACY', 'APOLLO', 'MEDICAL', 'KAYA SKIN', 'ZEUS UNISEX', 'SALON', 'SPA', 'AVANTARA', 'ELITE SPA', 'DR DIVYA'],
            'Electronics': ['I SHOP', 'ISHOP', 'APPLE', 'CROMA'],
            'Bills & Utilities': ['PAYATRIA', 'ACT ATRIA', 'LIVPURE', 'MY GATE', 'PTMMY GATE', 'COMMISSIONER BBMP', 'ICICI LOMBARD', 'NATIONAL HIGHWAY', 'FASTAG', 'GATEWAY SECURITY', 'ARANYAKA'],
            'EMI & Finance': ['AMORTIZATION', 'INTEREST', 'ANNUAL FEE', 'IGST', 'FUEL SURCHARGE', 'DCC FEE', 'ICICIPRUDENT'],
            'International': ['DUBAI', 'COLOMBO', 'GALLE', 'FUJAIRAH', 'ABU DHABI', 'KATUNAYAKE', 'NUWARA', 'SHARJAH', 'SAN FRANCISCO'],
            'Payment': ['INFINITY PAYMENT', 'PAYMENT RECEIVED', 'REFUND', 'CHARGEBACK']
        };

        for (const [category, keywords] of Object.entries(categories)) {
            if (keywords.some(kw => desc.includes(kw))) {
                return category;
            }
        }
        return 'Other';
    }
}
