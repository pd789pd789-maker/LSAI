
async function upload() {
  const FormData = require('form-data');
  const fs = require('fs');
  const form = new FormData();
  form.append('file', fs.createReadStream('pixel.png'));
  
  try {
     const res = await fetch('https://tmpfiles.org/api/v1/upload', {
        method: 'POST',
        body: form
     });
     const json = await res.json();
     console.log(json);
  } catch(e) {
     console.error(e);
  }
}
upload();
