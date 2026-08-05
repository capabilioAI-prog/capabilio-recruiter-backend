const pdfParse = require("pdf-parse");

/**
 * Extracts plain text from a PDF buffer. Returns "" on failure rather than
 * throwing -- a resume that fails to parse should still create an
 * application (recruiter can review the PDF manually), not 500 the whole
 * submission.
 */
async function extractPdfText(buffer) {
  try {
    const data = await pdfParse(buffer);
    return (data.text || "").trim();
  } catch (err) {
    console.error("PDF parse failed:", err.message);
    return "";
  }
}

module.exports = { extractPdfText };
