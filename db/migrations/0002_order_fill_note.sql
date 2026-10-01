-- Why the Opening Bell scaled down or cancelled an order (for example, no opening
-- price, or a price gap that left too little cash). The Compliance Desk's own
-- verdict stays in verdict_note.
ALTER TABLE orders ADD COLUMN fill_note TEXT;
