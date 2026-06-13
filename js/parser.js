/**
 * SpendTracker - PDF Statement Parser
 * Universal bank-agnostic credit card statement parser
 * Supports banks worldwide: auto-detects date format, currency, and amount style
 */

class StatementParser {
    constructor() {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        this.monthMap = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
        this.detectedCurrency = null;
        // All ISO 4217 codes we recognize
        this.currencyCodes = ['INR','USD','EUR','GBP','AED','CAD','AUD','SGD','HKD','JPY','CNY','CHF','SEK','NOK','DKK','NZD','ZAR','BRL','MXN','KRW','THB','MYR','PHP','IDR','TWD','PLN','CZK','HUF','TRY','SAR','QAR','KWD','BHD','OMR','EGP','LKR','BDT','PKR','NPR','ILS','RUB','UAH','RON','BGN','HRK','ISK','VND','CLP','COP','PEN','ARS'];
        this.currencySymbols = { '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₹': 'INR', '₩': 'KRW', '₪': 'ILS', '₫': 'VND', '₱': 'PHP', 'R$': 'BRL', 'RM': 'MYR', 'S$': 'SGD', 'HK$': 'HKD', 'A$': 'AUD', 'C$': 'CAD', 'NZ$': 'NZD', 'kr': 'SEK', 'Fr': 'CHF', 'zł': 'PLN', 'Kč': 'CZK', 'Ft': 'HUF', '₺': 'TRY', 'R': 'ZAR' };
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

        // Auto-detect currency from statement text
        this.detectCurrency(fullText);

        // Auto-detect which date format this statement uses
        const formatCounts = {
            'dmy-alpha': (fullText.match(/\d{2}-(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)-\d{2,4}/gi) || []).length,
            'dmy-slash': (fullText.match(/\d{2}\/\d{2}\/\d{4}/g) || []).length,
            'dmy-dash': (fullText.match(/\d{2}-\d{2}-\d{4}/g) || []).length,
            'dmy-slash-short': (fullText.match(/\d{2}\/\d{2}\/\d{2}(?!\d)/g) || []).length,
            'ymd-dash': (fullText.match(/\d{4}-\d{2}-\d{2}/g) || []).length,
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
        } else if (this.activeFormat === 'ymd-dash') {
            splitRegex = /(?=\d{4}-\d{2}-\d{2})/g;
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

    detectCurrency(text) {
        // Check for currency symbols first
        for (const [sym, code] of Object.entries(this.currencySymbols)) {
            if (text.includes(sym)) {
                this.detectedCurrency = code;
                return;
            }
        }
        // Check for currency codes
        const codePattern = new RegExp('\\b(' + this.currencyCodes.join('|') + ')\\b', 'g');
        const matches = text.match(codePattern);
        if (matches && matches.length > 0) {
            // Pick the most frequent code
            const freq = {};
            matches.forEach(m => freq[m] = (freq[m] || 0) + 1);
            this.detectedCurrency = Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
        }
        if (!this.detectedCurrency) this.detectedCurrency = 'USD'; // default fallback
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

        // Try YYYY-MM-DD (ISO 8601 - used by many European/Asian banks)
        if (!dateMatch) {
            dateMatch = segment.match(/^(\d{4})-(\d{2})-(\d{2})/);
            if (dateMatch) {
                year = dateMatch[1];
                month = parseInt(dateMatch[2]) - 1;
                day = dateMatch[3];
                date = new Date(parseInt(year), month, parseInt(day));
                const monthNames = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
                dateStr = `${day}-${monthNames[month]}-${String(year).slice(-2)}`;
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
            rest.includes('Reward Points') || rest.includes('Page ') ||
            rest.includes('Minimum Payment') || rest.includes('Credit Limit') ||
            rest.includes('Available Balance') || rest.includes('Previous Balance') ||
            rest.includes('New Balance') || rest.includes('Account Summary')) {
            return null;
        }

        // Try to extract amount - supports both formats:
        // Anglo: 1,234.56 (US/UK/India/most) or European: 1.234,56 (Germany/France/Brazil)
        // Also handles: -1,234.56 or 1234.56 or 1234,56
        let allAmounts = rest.match(/-?[\d,]+\.\d{2}/g); // Anglo format first
        let isEuropean = false;
        if (!allAmounts || allAmounts.length === 0) {
            // Try European format: 1.234,56
            allAmounts = rest.match(/-?[\d.]+,\d{2}/g);
            isEuropean = true;
        }
        if (!allAmounts || allAmounts.length === 0) return null;

        const rawAmount = allAmounts[allAmounts.length - 1];
        let parsedAmount;
        if (isEuropean) {
            parsedAmount = parseFloat(rawAmount.replace(/\./g, '').replace(',', '.'));
        } else {
            parsedAmount = parseFloat(rawAmount.replace(/,/g, ''));
        }
        
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

        // Remove currency codes and symbols from description
        const currencyRegex = new RegExp('\\b(' + this.currencyCodes.join('|') + ')\\b\\s*', 'gi');
        description = description.replace(currencyRegex, '').trim();
        description = description.replace(/[₹$€£¥₩₪₫₱₺]/g, '').trim();
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

        // Detect currency for this transaction (or use statement-level detected currency)
        let currency = this.detectedCurrency || 'USD';
        const txnCurrencyMatch = segment.match(new RegExp('\\b(' + this.currencyCodes.join('|') + ')\\b', 'i'));
        if (txnCurrencyMatch) {
            currency = txnCurrencyMatch[1].toUpperCase();
        }

        // Detect Cr/Dr indicator (many banks worldwide use this)
        let isCredit = parsedAmount < 0;
        if (/\bCr\.?\s*$/i.test(rest) || /\bCR\s*$/i.test(rest) || /\bCREDIT\s*$/i.test(rest)) {
            isCredit = true;
        }
        if (/\bDr\.?\s*$/i.test(rest) || /\bDR\s*$/i.test(rest) || /\bDEBIT\s*$/i.test(rest)) {
            isCredit = false;
        }

        return {
            id: this.generateId(),
            date: date,
            dateStr: dateStr,
            refNumber: refNumber,
            description: this.cleanDescription(description),
            amount: Math.abs(parsedAmount),
            currency: currency,
            isCredit: isCredit,
            tag: '',
            note: ''
        };
    }

    cleanDescription(desc) {
        desc = desc.replace(/\s+/g, ' ').trim();
        desc = desc.replace(/^[\d\s]+/, '').trim();
        // Remove any URL fragments (http/https/www patterns mangled by PDF extraction)
        desc = desc.replace(/https?[a-zA-Z0-9./\-_]*/gi, '').trim();
        desc = desc.replace(/www[a-zA-Z0-9./\-_]*/gi, '').trim();
        // Final PII pass on cleaned description
        desc = this.redactPII(desc);
        if (desc.length > 60) desc = desc.substring(0, 60) + '...';
        return desc;
    }

    redactPII(text) {
        // Bank account numbers (keywords + digits)
        text = text.replace(/\b(Acc|A\/c|Account|Acct|Konto|Compte|Cuenta)\s*[#:]?\s*\w{0,2}(\d{4,})\b/gi, (m, prefix) => prefix + ' ****');
        
        // IBAN (2 letter country + 2 check digits + up to 30 alphanumeric)
        text = text.replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{4,30}\b/g, '[IBAN REDACTED]');
        
        // SWIFT/BIC codes (8 or 11 chars: 4 bank + 2 country + 2 location + optional 3 branch)
        text = text.replace(/\b[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?\b/g, (match) => {
            // Avoid false positives on normal words - must have digits
            if (/\d/.test(match)) return '[SWIFT REDACTED]';
            return match;
        });
        
        // US SSN (XXX-XX-XXXX)
        text = text.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN REDACTED]');
        
        // UAE Emirates ID (784-YYYY-NNNNNNN-C)
        text = text.replace(/\b784-\d{4}-\d{7}-\d\b/g, '[EMIRATES ID REDACTED]');
        // Emirates ID without dashes (15 digits starting with 784)
        text = text.replace(/\b784\d{12}\b/g, '[EMIRATES ID REDACTED]');
        
        // Indian PAN (ABCDE1234F)
        text = text.replace(/\b[A-Z]{5}\d{4}[A-Z]\b/g, '[PAN REDACTED]');
        
        // National ID numbers (12+ digits grouped, e.g. Aadhaar, SIN, NI number)
        text = text.replace(/\b\d{4}\s?\d{4}\s?\d{4}\b/g, (match) => {
            if (match.replace(/\s/g, '').length === 12) return '[ID REDACTED]';
            return match;
        });
        
        // Phone numbers - international format (+XX or +XXX followed by digits)
        text = text.replace(/\+\d{1,3}[\s.-]?\(?\d{1,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}\b/g, '[PHONE REDACTED]');
        // Phone - Indian (10 digits starting with 6-9)
        text = text.replace(/\b[6-9]\d{9}\b/g, '[PHONE REDACTED]');
        // Phone - North American (XXX-XXX-XXXX)
        text = text.replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[PHONE REDACTED]');
        
        // Email addresses
        text = text.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL REDACTED]');
        
        // UPI IDs (name@bank - India specific)
        text = text.replace(/[a-zA-Z0-9._-]+@[a-zA-Z]{2,10}\b/g, (match) => {
            if (match.includes('.')) return match;
            return '[UPI REDACTED]';
        });
        
        // Sort codes (UK: XX-XX-XX), BSB (Australia: XXX-XXX), IFSC (India: 4+0+6)
        text = text.replace(/\b[A-Z]{4}0[A-Z0-9]{6}\b/g, '[BANK CODE REDACTED]');
        
        // Generic long digit sequences (10+ digits - potential account/ID numbers)
        text = text.replace(/\b\d{10,18}\b/g, (match) => '****' + match.slice(-4));
        
        return text;
    }

    generateId() {
        return 'txn_' + Math.random().toString(36).substring(2, 11);
    }

    categorize(description) {
        const desc = description.toUpperCase();
        
        const categories = {
            'Food & Dining': ['ZOMATO', 'SWIGGY', 'BLINKIT', 'ZEPTO', 'MC DONALD', 'MCDONALD', 'STARBUCKS', 'CHAAYOS', 'DOMINO', 'KFC', 'PIZZA', 'CAFE', 'RESTAURANT', 'FOOD', 'BAKERY', 'KITCHEN', 'BIRYANI', 'CHOWMAN', 'EAZYDINER', 'BOOKMYSHOW', 'PVR', 'CINEPOLIS', 'INSTAMART', 'UBER EATS', 'DOORDASH', 'GRUBHUB', 'JUST EAT', 'DELIVEROO', 'POSTMATES', 'CHIPOTLE', 'SUBWAY', 'BURGER KING', 'WENDY', 'TACO BELL', 'DUNKIN', 'TIM HORTON', 'NANDO', 'GREGGS', 'PRET A MANGER', 'FIVE GUYS', 'CHICK-FIL-A', 'DINER', 'BISTRO', 'EATERY', 'GRILL', 'SUSHI', 'RAMEN', 'WOK', 'KEBAB', 'TALABAT', 'NOON FOOD', 'CAREEM NOW', 'ZOMATO UAE', 'SALT BURGER', 'AL BAIK', 'SHAKE SHACK', 'CHEESECAKE FACTORY', 'TGI FRIDAY', 'PAUL BAKERY', 'PAUL CAFE', 'CHILI', 'APPLEBEE', 'TEXAS ROADHOUSE'],
            'Travel': ['INDIGO', 'AIR INDIA', 'MAKEMYTRIP', 'CLEARTRIP', 'ETIHAD', 'UBER', 'OLA', 'IRCTC', 'AIRBNB', 'HOTEL', 'RADISSON', 'DREAMFOLKS', 'AIRLINE', 'AIRWAYS', 'DELTA', 'UNITED', 'SOUTHWEST', 'JETBLUE', 'RYANAIR', 'EASYJET', 'BRITISH AIRWAY', 'LUFTHANSA', 'EMIRATES', 'QATAR', 'SINGAPORE AIR', 'CATHAY', 'QANTAS', 'AMERICAN AIR', 'HILTON', 'MARRIOTT', 'HYATT', 'IHG', 'HOLIDAY INN', 'BEST WESTERN', 'BOOKING.COM', 'EXPEDIA', 'TRIVAGO', 'KAYAK', 'SKYSCANNER', 'LYFT', 'BOLT', 'GRAB', 'GOJEK', 'DIDI', 'TRAIN', 'RAILWAY', 'AMTRAK', 'EUROSTAR', 'HERTZ', 'AVIS', 'ENTERPRISE RENT', 'PARKING', 'FLY DUBAI', 'FLYDUBAI', 'AIR ARABIA', 'WIZZ AIR', 'CAREEM', 'HALA TAXI', 'RTA', 'SALIK', 'NOL', 'METRO DUBAI', 'ROTANA', 'JUMEIRAH', 'ATLANTIS', 'BURJ', 'ARMANI HOTEL', 'ROVE HOTEL', 'SOFITEL', 'PULLMAN', 'DAMAC', 'EMAAR HOSPITALITY', 'MUSAFIR', 'WEGO', 'DNATA', 'ARABIAN ADVENTURES'],
            'Shopping': ['AMAZON', 'FLIPKART', 'MYNTRA', 'ZARA', 'H&M', 'HENNES', 'WESTSIDE', 'ZUDIO', 'RELIANCE', 'LIFESTYLE', 'NIKE', 'BATA', 'FABINDIA', 'TITAN', 'LENSKART', 'NYKAA', 'RAYMOND', 'CHANEL', 'WALMART', 'TARGET', 'COSTCO', 'EBAY', 'ETSY', 'SHEIN', 'ASOS', 'PRIMARK', 'UNIQLO', 'GAP', 'OLD NAVY', 'NORDSTROM', 'MACY', 'TJ MAXX', 'MARSHALLS', 'ROSS STORE', 'IKEA', 'WAYFAIR', 'ALIEXPRESS', 'TEMU', 'WISH.COM', 'SEPHORA', 'ADIDAS', 'PUMA', 'REEBOK', 'GUCCI', 'LOUIS VUITTON', 'HERMES', 'PRADA', 'TIFFANY', 'CARTIER', 'ROLEX', 'BEST BUY', 'HOME DEPOT', 'LOWE', 'JOHN LEWIS', 'MARKS SPENCER', 'TESCO', 'SAINSBURY', 'ALDI', 'LIDL', 'CARREFOUR', 'NOON.COM', 'NOON ', 'NAMSHI', 'SIVVI', 'OUNASS', 'MUMZWORLD', 'SHARAF DG', 'EMAX', 'DUBAI MALL', 'MALL OF EMIRATES', 'CITY CENTRE', 'IBN BATTUTA', 'FESTIVAL CITY', 'DUBAI OUTLET', 'SPLASH', 'MAX FASHION', 'CENTREPOINT', 'BABYSHOP', 'HOME CENTRE', 'HOME BOX', 'ACE HARDWARE', 'LULU', 'LANDMARK GROUP', 'CHALHOUB', 'LEVEL SHOES', 'DAMAS', 'JOYALUKKAS', 'MALABAR GOLD', 'PURE GOLD'],
            'Groceries': ['INNOVATIVE RETAIL', 'BLINKIT', 'BIGBASKET', 'GROCERY', 'SUPERMARKET', 'WHOLE FOODS', 'TRADER JOE', 'KROGER', 'PUBLIX', 'WEGMANS', 'SPROUTS', 'FRESH MARKET', 'SAFEWAY', 'ASDA', 'WAITROSE', 'MORRISONS', 'MERCADONA', 'REWE', 'EDEKA', 'COLES', 'WOOLWORTHS', 'INSTACART', 'FRESH DIRECT', 'OCADO', 'MARKET', 'LULU HYPERMARKET', 'LULU MARKET', 'CARREFOUR HYPER', 'CARREFOUR MARKET', 'UNION COOP', 'CHOITHRAMS', 'SPINNEYS', 'WAITROSE UAE', 'GEANT', 'GRANDIOSE', 'KIBSONS', 'BARAKAT', 'NOON GROCERY', 'NOON DAILY', 'NESTO', 'VIVA SUPERMARKET', 'AL MAYA', 'AL MADINA'],
            'Fuel': ['FUEL', 'PETROL', 'GASOLINE', 'GAS STATION', 'BPCL', 'SHELL', 'FILLING STATION', 'ADNOC', 'ADNOC DIST', 'EXXON', 'MOBIL', 'CHEVRON', 'BP ', 'TEXACO', 'TOTAL ENERGIES', 'ESSO', 'CALTEX', 'SINOPEC', 'PETRONAS', 'ENOC', 'EPPCO', 'EMARAT', 'EV CHARG', 'TESLA SUPERCHARG', 'CHARGEPOINT', 'UAEPASS PARKING', 'PARKIN'],
            'Health & Beauty': ['PHARMACY', 'APOLLO', 'MEDICAL', 'SALON', 'SPA', 'CVS', 'WALGREENS', 'BOOTS', 'SUPERDRUG', 'RITE AID', 'HOSPITAL', 'CLINIC', 'DOCTOR', 'DENTIST', 'DENTAL', 'OPTICIAN', 'OPTICAL', 'PHYSIOTHERAPY', 'DERMATOLOG', 'HEALTH', 'WELLNESS', 'GYM', 'FITNESS', 'ASTER', 'MEDICLINIC', 'NMC HEALTH', 'AL NOOR', 'THUMBAY', 'SUPERCARE', 'LIFE PHARMACY', 'BIN SINA', 'NAHDI', 'FITNESS FIRST', 'GOLD GYM', 'BAREFOOT', 'TALISE SPA'],
            'Electronics': ['APPLE', 'CROMA', 'BEST BUY', 'CURRYS', 'MEDIA MARKT', 'SAMSUNG', 'MICROSOFT STORE', 'B&H PHOTO', 'NEWEGG'],
            'Subscriptions': ['NETFLIX', 'SPOTIFY', 'DISNEY', 'HULU', 'HBO', 'PRIME VIDEO', 'YOUTUBE', 'APPLE MUSIC', 'APPLE TV', 'AUDIBLE', 'KINDLE', 'ADOBE', 'MICROSOFT 365', 'GOOGLE ONE', 'DROPBOX', 'ICLOUD', 'OPENAI', 'CHATGPT', 'NOTION', 'FIGMA', 'CANVA', 'LINKEDIN PREMIUM', 'MEDIUM', 'PATREON', 'TWITCH', 'CRUNCHYROLL'],
            'Bills & Utilities': ['ELECTRIC', 'WATER BILL', 'GAS BILL', 'INTERNET', 'BROADBAND', 'MOBILE BILL', 'PHONE BILL', 'INSURANCE', 'PAYATRIA', 'FASTAG', 'TOLL', 'COUNCIL TAX', 'PROPERTY TAX', 'RENT', 'MORTGAGE', 'CABLE', 'WIFI', 'TELECOM', 'VODAFONE', 'AT&T', 'VERIZON', 'T-MOBILE', 'COMCAST', 'SPECTRUM', 'BT GROUP', 'SKY TV', 'UTILITY', 'DEWA', 'SEWA', 'FEWA', 'AADC', 'ADDC', 'ETISALAT', 'DU TELECOM', 'DU BILL', 'VIRGIN MOBILE AE', 'SALIK RECHARGE', 'DARB', 'EJARI', 'TAWTHEEQ', 'ADHA', 'ICA', 'AMER', 'TYPSA', 'DAMAN', 'ORIENT INSURANCE', 'SUKOON INSURANCE', 'AL WATHBA'],
            'EMI & Finance': ['AMORTIZATION', 'INTEREST', 'ANNUAL FEE', 'GST', 'IGST', 'FUEL SURCHARGE', 'DCC FEE', 'LATE FEE', 'FINANCE CHARGE', 'INSTALMENT', 'INSTALLMENT', 'EMI ', 'LOAN', 'CREDIT CARD FEE', 'FOREIGN TRANSACTION', 'SERVICE CHARGE', 'OVERLIMIT', 'MEMBERSHIP FEE', 'VAT', 'MURABAHA', 'TAKAFUL', 'PROFIT CHARGE', 'ADMIN FEE', 'PROCESSING FEE'],
            'Transfer': ['VENMO', 'ZELLE', 'PAYPAL', 'CASH APP', 'WISE', 'REVOLUT', 'GOOGLE PAY', 'APPLE PAY', 'SAMSUNG PAY', 'PAYTM', 'PHONEPE', 'UPI', 'TRANSFER', 'WIRE TRANSFER', 'ACH', 'AL ANSARI EXCHANGE', 'UAE EXCHANGE', 'WESTERN UNION', 'MONEYGRAM', 'EXCHANGE HOUSE', 'AL FARDAN', 'TRRIPLE', 'BOTIM PAY', 'PAYIT'],
            'Payment': ['INFINITY PAYMENT', 'PAYMENT RECEIVED', 'REFUND', 'CHARGEBACK', 'PAYMENT THANK', 'AUTO PAY', 'AUTOPAY', 'CREDIT RECEIVED', 'REVERSAL', 'CASHBACK']
        };

        for (const [category, keywords] of Object.entries(categories)) {
            if (keywords.some(kw => desc.includes(kw))) {
                return category;
            }
        }
        return 'Other';
    }
}
