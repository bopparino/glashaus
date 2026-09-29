"""Read only bounded regular outputs; never follow sandbox-created links."""
import os, stat, json, base64, io, zipfile
from pathlib import Path
from pypdf import PdfReader
TYPES = {'.pdf':'application/pdf', '.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.txt':'text/plain', '.csv':'text/csv'}
root = Path('/work/output')
if not root.exists():
    print('[]'); raise SystemExit()
if root.is_symlink() or not root.is_dir():
    raise ValueError('Output must be a regular directory')
files = sorted(root.iterdir())
if len(files) > 8: raise ValueError('Return at most eight output files')
result = []
total = 0
for path in files:
    if path.suffix not in TYPES: raise ValueError('Unsupported output type: '+path.suffix)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as file:
        info = os.fstat(file.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or not 0 < info.st_size <= 8*1024*1024: raise ValueError('Invalid output file')
        data = file.read(8*1024*1024+1)
    total += len(data)
    if total > 12*1024*1024: raise ValueError('Output exceeds 12 MB')
    if path.suffix == '.pdf':
        pdf = PdfReader(io.BytesIO(data), strict=True)
        if not 1 <= len(pdf.pages) <= 60: raise ValueError('Document exceeds 60 pages')
        catalog = pdf.trailer['/Root']
        action = catalog.get('/OpenAction')
        if hasattr(action, 'get_object'): action = action.get_object()
        if '/AA' in catalog or (isinstance(action, dict) and action.get('/S') != '/GoTo'): raise ValueError('Active PDF content is not supported')
        names = catalog.get('/Names', {})
        if hasattr(names, 'get_object'): names = names.get_object()
        if any(k in names for k in ['/JavaScript', '/EmbeddedFiles']): raise ValueError('Active PDF content is not supported')
        for page in pdf.pages:
            if '/AA' in page: raise ValueError('Active page content is not supported')
            for ref in page.get('/Annots', []):
                annotation = ref.get_object()
                if '/AA' in annotation or '/A' in annotation: raise ValueError('Active annotation content is not supported')
    elif path.suffix == '.docx':
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            if sum(i.file_size for i in z.infolist()) > 32*1024*1024 or 'word/document.xml' not in z.namelist(): raise ValueError('Invalid document archive')
            if any('vbaProject' in n or n.startswith(('word/embeddings/', 'word/activeX/')) for n in z.namelist()): raise ValueError('Active document content is not supported')
    else: data.decode('utf-8')
    result.append({'name': path.name, 'mime': TYPES[path.suffix], 'data': base64.b64encode(data).decode()})
print(json.dumps(result))
