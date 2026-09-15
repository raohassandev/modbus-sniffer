'use strict';

const FC_NAMES = {
  1: 'Read Coils', 2: 'Read Discrete Inputs', 3: 'Read Holding Registers', 4: 'Read Input Registers',
  5: 'Write Single Coil', 6: 'Write Single Register', 7: 'Read Exception Status', 8: 'Diagnostics',
  11: 'Get Comm Event Counter', 12: 'Get Comm Event Log', 15: 'Write Multiple Coils',
  16: 'Write Multiple Registers', 17: 'Report Server ID', 20: 'Read File Record',
  21: 'Write File Record', 22: 'Mask Write Register', 23: 'Read/Write Multiple Registers',
  24: 'Read FIFO Queue', 43: 'Encapsulated Interface Transport'
};

const EXCEPTION_NAMES = {
  1: 'Illegal Function', 2: 'Illegal Data Address', 3: 'Illegal Data Value', 4: 'Slave Device Failure',
  5: 'Acknowledge', 6: 'Slave Device Busy', 8: 'Memory Parity Error', 10: 'Gateway Path Unavailable',
  11: 'Gateway Target Failed to Respond'
};

const DEVICE_ID_OBJECT_NAMES = {
  0: 'VendorName', 1: 'ProductCode', 2: 'MajorMinorRevision', 3: 'VendorUrl',
  4: 'ProductName', 5: 'ModelName', 6: 'UserApplicationName'
};

const DIAGNOSTIC_SUBFUNCTION_NAMES = {
  0x0000: 'Return Query Data',
  0x0001: 'Restart Communications Option',
  0x0002: 'Return Diagnostic Register',
  0x0003: 'Change ASCII Input Delimiter',
  0x0004: 'Force Listen Only Mode',
  0x000A: 'Clear Counters and Diagnostic Register',
  0x000B: 'Return Bus Message Count',
  0x000C: 'Return Bus Communication Error Count',
  0x000D: 'Return Bus Exception Error Count',
  0x000E: 'Return Server Message Count',
  0x000F: 'Return Server No Response Count',
  0x0010: 'Return Server NAK Count',
  0x0011: 'Return Server Busy Count',
  0x0012: 'Return Bus Character Overrun Count',
  0x0014: 'Clear Overrun Counter and Flag'
};

function u16(buf, i) { return buf.readUInt16BE(i); }
function wordsFromData(data) {
  const words = [];
  for (let i = 0; i + 1 < data.length; i += 2) words.push(u16(data, i));
  return words;
}
function bitsFromData(data) {
  const bits = [];
  for (const b of data) for (let bit = 0; bit < 8; bit++) bits.push(Boolean(b & (1 << bit)));
  return bits;
}
function cleanDeviceIdText(buf){
  return Buffer.from(buf||[]).toString('utf8').replace(/\0+$/g,'').trim();
}
function addWarning(out,message){
  out.payloadValid=false;
  out.protocolWarning=out.protocolWarning?`${out.protocolWarning} ${message}`:message;
}
function validQuantity(out,quantity,min,max,label='Quantity'){
  if(!Number.isInteger(quantity)||quantity<min||quantity>max){addWarning(out,`${label} ${quantity} is outside ${min}..${max}.`);return false;}
  return true;
}
function exactPayload(frame, expectedEnd, out, label='Payload'){
  const actualEnd=frame.length-2;
  if(expectedEnd!==actualEnd){addWarning(out,`${label} length mismatch: expected ${expectedEnd} byte offset, got ${actualEnd}.`);return false;}
  return true;
}

function decodeDeviceIdResponse(frame,out){
  out.kind='response';
  out.meiType=frame[2];
  out.readDeviceIdCode=frame[3];
  out.conformityLevel=frame[4];
  out.moreFollows=frame[5]!==0;
  out.nextObjectId=frame[6];
  out.numberOfObjects=frame[7]||0;
  out.objects=[];
  out.objectMap={};
  let pos=8;
  const end=Math.max(pos,frame.length-2);
  for(let i=0;i<out.numberOfObjects;i++){
    if(pos+2>end){addWarning(out,'Truncated Read Device Identification object header.');break;}
    const objectId=frame[pos++],length=frame[pos++];
    if(pos+length>end){addWarning(out,`Truncated Read Device Identification object ${objectId}.`);break;}
    const raw=Buffer.from(frame.subarray(pos,pos+length));pos+=length;
    const value=cleanDeviceIdText(raw),name=DEVICE_ID_OBJECT_NAMES[objectId]||`Object${objectId}`;
    const object={objectId,name,length,value,rawHex:raw.toString('hex').toUpperCase()};
    out.objects.push(object);out.objectMap[objectId]=value;
  }
  if(out.payloadValid!==false){out.payloadValid=pos===end;if(pos!==end)addWarning(out,`Read Device Identification payload has ${end-pos} trailing byte(s).`);}
  out.identification={
    vendorName:out.objectMap[0]??null,
    productCode:out.objectMap[1]??null,
    revision:out.objectMap[2]??null,
    vendorUrl:out.objectMap[3]??null,
    productName:out.objectMap[4]??null,
    modelName:out.objectMap[5]??null,
    userApplicationName:out.objectMap[6]??null
  };
}

function parseReadFileRequest(frame,out){
  out.kind='request';out.byteCount=frame[2];out.records=[];
  const end=frame.length-2;
  if(out.byteCount<7||out.byteCount>245||out.byteCount%7!==0||!exactPayload(frame,3+out.byteCount,out,'FC20 request'))return;
  let pos=3;
  while(pos<end){
    const referenceType=frame[pos],fileNumber=u16(frame,pos+1),recordNumber=u16(frame,pos+3),recordLength=u16(frame,pos+5);
    if(referenceType!==6)addWarning(out,`FC20 reference type ${referenceType} is not the standard value 6.`);
    if(recordLength<1||recordLength>125)addWarning(out,`FC20 record length ${recordLength} is outside 1..125.`);
    out.records.push({referenceType,fileNumber,recordNumber,recordLength});pos+=7;
  }
}

function parseReadFileResponse(frame,out){
  out.kind='response';out.byteCount=frame[2];out.records=[];
  const end=frame.length-2;
  if(out.byteCount<3||out.byteCount>250||!exactPayload(frame,3+out.byteCount,out,'FC20 response'))return;
  let pos=3;
  while(pos<end){
    const subLength=frame[pos++];
    if(subLength<3||pos+subLength>end){addWarning(out,'Malformed FC20 sub-response length.');break;}
    const referenceType=frame[pos++],dataLength=subLength-1;
    if(referenceType!==6)addWarning(out,`FC20 response reference type ${referenceType} is not 6.`);
    if(dataLength%2!==0){addWarning(out,'FC20 record data byte count must be even.');break;}
    const data=Buffer.from(frame.subarray(pos,pos+dataLength));pos+=dataLength;
    out.records.push({referenceType,byteCount:dataLength,data,words:wordsFromData(data)});
  }
  if(pos!==end)addWarning(out,`FC20 response has ${end-pos} trailing byte(s).`);
}

function parseWriteFileRecords(frame,out){
  out.kind='ambiguous';out.byteCount=frame[2];out.records=[];
  const end=frame.length-2;
  if(out.byteCount<9||out.byteCount>251||!exactPayload(frame,3+out.byteCount,out,'FC21 payload'))return;
  let pos=3;
  while(pos<end){
    if(pos+7>end){addWarning(out,'Truncated FC21 record header.');break;}
    const referenceType=frame[pos],fileNumber=u16(frame,pos+1),recordNumber=u16(frame,pos+3),recordLength=u16(frame,pos+5),dataBytes=recordLength*2;
    pos+=7;
    if(referenceType!==6)addWarning(out,`FC21 reference type ${referenceType} is not the standard value 6.`);
    if(recordLength<1||recordLength>122){addWarning(out,`FC21 record length ${recordLength} is outside 1..122.`);break;}
    if(pos+dataBytes>end){addWarning(out,'Truncated FC21 record data.');break;}
    const data=Buffer.from(frame.subarray(pos,pos+dataBytes));pos+=dataBytes;
    out.records.push({referenceType,fileNumber,recordNumber,recordLength,data,words:wordsFromData(data)});
  }
  if(pos!==end)addWarning(out,`FC21 payload has ${end-pos} trailing byte(s).`);
  out.matchToken=`${out.byteCount}:${frame.subarray(3,end).toString('hex').toUpperCase()}`;
}

function decodeFrame(frame) {
  const slaveId = frame[0];
  const rawFc = frame[1];
  const exception = Boolean(rawFc & 0x80);
  const fc = rawFc & 0x7F;
  const out = { slaveId, functionCode: fc, functionName: FC_NAMES[fc] || `Function ${fc}`, exception, raw: frame, payloadValid:true };

  if (exception) {
    out.kind = 'response';
    out.exceptionCode = frame[2];
    out.exceptionName = EXCEPTION_NAMES[out.exceptionCode] || 'Unknown Exception';
    return out;
  }

  switch (fc) {
    case 1: case 2: {
      if (frame.length === 8 && frame[2] === 3) {
        out.kind = 'ambiguous-read';
        out.startAddress = u16(frame, 2);
        out.quantity = u16(frame, 4);
        validQuantity(out,out.quantity,1,2000);
        out.byteCount = frame[2];
        out.data = frame.subarray(3, 3 + out.byteCount);
        out.bits = bitsFromData(out.data);
      } else if (frame.length === 8) {
        out.kind = 'request';
        out.startAddress = u16(frame, 2);
        out.quantity = u16(frame, 4);
        validQuantity(out,out.quantity,1,2000);
      } else {
        out.kind = 'response';
        out.byteCount = frame[2];
        if(out.byteCount<1||out.byteCount>250||!exactPayload(frame,3+out.byteCount,out,`FC${fc} response`))break;
        out.data = frame.subarray(3, 3 + out.byteCount);
        out.bits = bitsFromData(out.data);
      }
      break;
    }
    case 3: case 4:
      if (frame.length === 8) {
        out.kind = 'request'; out.startAddress = u16(frame, 2); out.quantity = u16(frame, 4);
        validQuantity(out,out.quantity,1,125);
      } else {
        out.kind = 'response'; out.byteCount = frame[2];
        if(out.byteCount<2||out.byteCount>250||out.byteCount%2!==0||!exactPayload(frame,3+out.byteCount,out,`FC${fc} response`))break;
        out.data = frame.subarray(3, 3 + out.byteCount);out.words = wordsFromData(out.data);
      }
      break;
    case 5: case 6:
      out.kind = 'ambiguous'; out.address = u16(frame, 2); out.value = u16(frame, 4); out.matchToken = `${out.address}:${out.value}`;
      break;
    case 7:
      if (frame.length === 4) out.kind = 'request';
      else { out.kind = 'response'; out.status = frame[2]; if(frame.length!==5)addWarning(out,'FC07 response must contain exactly one status byte.'); }
      break;
    case 8: {
      out.kind='ambiguous';out.subFunction=u16(frame,2);out.subFunctionName=DIAGNOSTIC_SUBFUNCTION_NAMES[out.subFunction]||`Diagnostics Subfunction ${out.subFunction}`;
      const end=frame.length-2;out.data=Buffer.from(frame.subarray(4,end));
      if(out.data.length%2!==0)addWarning(out,'FC08 diagnostic data length must be even.');
      out.dataWords=wordsFromData(out.data);out.dataWord=out.dataWords[0]??null;
      out.matchToken=`${out.subFunction}:${out.data.toString('hex').toUpperCase()}`;
      break;
    }
    case 11:
      if (frame.length === 4) out.kind = 'request';
      else { out.kind = 'response'; out.status = u16(frame, 2); out.eventCount = u16(frame, 4); if(frame.length!==8)addWarning(out,'FC11 response length must be 8 RTU bytes.'); }
      break;
    case 12: case 17:
      if (frame.length === 4) out.kind = 'request';
      else { out.kind = 'response'; out.byteCount = frame[2]; if(!exactPayload(frame,3+out.byteCount,out,`FC${fc} response`))break; out.data = frame.subarray(3, 3 + out.byteCount); }
      break;
    case 15: case 16:
      if (frame.length === 8) {
        out.kind = 'response'; out.startAddress = u16(frame, 2); out.quantity = u16(frame, 4);
        validQuantity(out,out.quantity,1,fc===15?1968:123);
      } else {
        out.kind = 'request'; out.startAddress = u16(frame, 2); out.quantity = u16(frame, 4); out.byteCount = frame[6];
        const max=fc===15?1968:123,expected=fc===15?Math.ceil(out.quantity/8):out.quantity*2;
        validQuantity(out,out.quantity,1,max);
        if(out.byteCount!==expected)addWarning(out,`FC${fc} byte count ${out.byteCount} does not match quantity ${out.quantity} (expected ${expected}).`);
        if(!exactPayload(frame,7+out.byteCount,out,`FC${fc} request`))break;
        out.data = frame.subarray(7, 7 + out.byteCount); if (fc === 16&&out.payloadValid) out.words = wordsFromData(out.data);
      }
      break;
    case 20:
      if(frame[3]===6)parseReadFileRequest(frame,out);else parseReadFileResponse(frame,out);
      break;
    case 21:
      parseWriteFileRecords(frame,out);
      break;
    case 22:
      out.kind = 'ambiguous'; out.address = u16(frame, 2); out.andMask = u16(frame, 4); out.orMask = u16(frame, 6);
      out.matchToken = `${out.address}:${out.andMask}:${out.orMask}`;
      break;
    case 23:
      if (frame.length >= 13 && frame[10] + 13 === frame.length) {
        out.kind = 'request'; out.readStartAddress = u16(frame, 2); out.readQuantity = u16(frame, 4);
        out.writeStartAddress = u16(frame, 6); out.writeQuantity = u16(frame, 8); out.byteCount = frame[10];
        validQuantity(out,out.readQuantity,1,125,'Read quantity');validQuantity(out,out.writeQuantity,1,121,'Write quantity');
        if(out.byteCount!==out.writeQuantity*2)addWarning(out,`FC23 byte count ${out.byteCount} does not match write quantity ${out.writeQuantity}.`);
        out.data = frame.subarray(11, 11 + out.byteCount); if(out.payloadValid)out.words = wordsFromData(out.data);
      } else {
        out.kind = 'response'; out.byteCount = frame[2];
        if(out.byteCount<2||out.byteCount>250||out.byteCount%2!==0||!exactPayload(frame,3+out.byteCount,out,'FC23 response'))break;
        out.data = frame.subarray(3, 3 + out.byteCount); out.words = wordsFromData(out.data);
      }
      break;
    case 24:
      if(frame.length===6){out.kind='request';out.fifoPointerAddress=u16(frame,2);}
      else{
        out.kind='response';out.byteCount=u16(frame,2);out.fifoCount=u16(frame,4);const expected=2+out.fifoCount*2;
        if(out.fifoCount>31)addWarning(out,`FC24 FIFO count ${out.fifoCount} exceeds the standard maximum 31.`);
        if(out.byteCount!==expected)addWarning(out,`FC24 byte count ${out.byteCount} does not match FIFO count ${out.fifoCount} (expected ${expected}).`);
        if(!exactPayload(frame,4+out.byteCount,out,'FC24 response'))break;
        out.data=Buffer.from(frame.subarray(6,frame.length-2));if(out.payloadValid)out.fifoValues=wordsFromData(out.data);
      }
      break;
    case 43: {
      out.meiType=frame[2];
      if(out.meiType!==0x0E){out.kind=frame.length===7?'request':'response';out.payload=frame.subarray(2,-2);break;}
      if(frame.length===7){out.kind='request';out.readDeviceIdCode=frame[3];out.objectId=frame[4];out.matchToken=`14:${out.readDeviceIdCode}:${out.objectId}`;}
      else if(frame.length>=10)decodeDeviceIdResponse(frame,out);
      else{out.kind='unknown';addWarning(out,'Truncated Read Device Identification frame.');}
      break;
    }
    default:
      out.kind = 'unknown'; out.payload = frame.subarray(2, -2);out.payloadHex=out.payload.toString('hex').toUpperCase();
  }

  return out;
}

module.exports = { decodeFrame, FC_NAMES, EXCEPTION_NAMES, DEVICE_ID_OBJECT_NAMES, DIAGNOSTIC_SUBFUNCTION_NAMES };
