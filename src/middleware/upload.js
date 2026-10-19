'use strict';

const path = require('path');
const multer = require('multer');
const AppError = require('../utils/AppError');

/** Spreadsheet uploads (product import): kept in memory (req.file.buffer), 5 MB max, .xlsx or .csv only. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (['.xlsx', '.csv'].includes(ext)) return cb(null, true);
    cb(new AppError('Upload an Excel (.xlsx) or CSV (.csv) file', 400, 'BAD_FILE_TYPE'));
  },
});

/** upload.spreadsheet  ->  the file arrives as req.file; text fields stay in req.body */
module.exports = { spreadsheet: upload.single('file') };
