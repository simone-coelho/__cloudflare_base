-- LOCAL DELIVERABLE ONLY: an authorized owner installs in the approved schema.
-- Review Hybrid Table availability, procedure grants, cleanup cadence and
-- history retention. Never auto-applied by provisioning or by the Worker.
-- Hybrid PK enforcement and row locks are essential: an informational PK on
-- a standard Snowflake table does NOT provide the required serialization.
CREATE HYBRID TABLE IF NOT EXISTS DELIVERY_LOCK_V1 (TENANT VARCHAR(64) PRIMARY KEY, SERIAL NUMBER NOT NULL);
CREATE TABLE IF NOT EXISTS DELIVERY_OPERATION_V1 (
 TENANT VARCHAR, GENERATION VARCHAR, OPERATION VARCHAR, DIGEST VARCHAR, SEQUENCE NUMBER,
 SOURCE VARCHAR, SOURCE_SEQUENCE NUMBER, PART NUMBER, FINAL BOOLEAN, TOTAL NUMBER,
 SOURCE_DIGEST VARCHAR, ROWS_EXPECTED VARCHAR, CUTOFFS_EXPECTED VARCHAR
);
CREATE TABLE IF NOT EXISTS DELIVERY_SOURCE_V1 (
 TENANT VARCHAR, GENERATION VARCHAR, SOURCE VARCHAR, ADMITTED NUMBER, COMMITTED NUMBER,
 REVISION VARCHAR, TOTAL NUMBER, DIGEST VARCHAR
);
CREATE TABLE IF NOT EXISTS DELIVERY_ROW_V1 (
 TENANT VARCHAR, GENERATION VARCHAR, SOURCE VARCHAR, SOURCE_SEQUENCE NUMBER, PART NUMBER,
 ID VARCHAR, SUBJECT VARCHAR, TS NUMBER, EXPIRES_AT NUMBER, HASH VARCHAR, WIRE VARCHAR
);
CREATE TABLE IF NOT EXISTS DELIVERY_CUTOFF_V1 (TENANT VARCHAR, SUBJECT VARCHAR, AT NUMBER);
CREATE TABLE IF NOT EXISTS DELIVERY_PART_V1 (TENANT VARCHAR,GENERATION VARCHAR,SOURCE VARCHAR,SOURCE_SEQUENCE NUMBER,PART NUMBER);
CREATE OR REPLACE SECURE VIEW DELIVERY_CURRENT_V1 AS
 SELECT R.TENANT,R.GENERATION,R.ID,R.SUBJECT,R.TS,R.EXPIRES_AT,R.HASH,PARSE_JSON(R.WIRE) RECORD
 FROM DELIVERY_ROW_V1 R JOIN DELIVERY_SOURCE_V1 S ON S.TENANT=R.TENANT AND S.GENERATION=R.GENERATION
 AND S.SOURCE=R.SOURCE AND S.COMMITTED=R.SOURCE_SEQUENCE
 LEFT JOIN DELIVERY_CUTOFF_V1 C ON C.TENANT=R.TENANT AND C.SUBJECT=R.SUBJECT
 WHERE R.EXPIRES_AT>DATE_PART(EPOCH_MILLISECOND,CURRENT_TIMESTAMP()) AND (C.AT IS NULL OR R.TS>C.AT)
 QUALIFY ROW_NUMBER() OVER(PARTITION BY R.TENANT,R.GENERATION,R.ID ORDER BY R.SOURCE)=1;

CREATE OR REPLACE PROCEDURE APPLY_DELIVERY_V1(WIRE VARCHAR)
RETURNS VARIANT LANGUAGE JAVASCRIPT EXECUTE AS OWNER AS
$$
function q(sql,binds){return snowflake.createStatement({sqlText:sql,binds:binds||[]}).execute();}
function scalar(sql,binds){var r=q(sql,binds);if(!r.next())throw 'missing scalar';return r.getColumnValue(1);}
function bad(v){if(!v)throw 'delivery refused';}
function sourceProof(tenant,generation,source,sequence,part){
 // One bounded set query over the retained source, not one SQL round trip per
 // upload part. Hash actual row WIRE, not the cached operation receipt.
 var sql="WITH RECURSIVE LIVE AS (SELECT R.* FROM DELIVERY_ROW_V1 R LEFT JOIN DELIVERY_CUTOFF_V1 C ON C.TENANT=R.TENANT AND C.SUBJECT=R.SUBJECT WHERE R.TENANT=? AND R.GENERATION=? AND R.SOURCE=? AND R.SOURCE_SEQUENCE=? AND R.EXPIRES_AT>DATE_PART(EPOCH_MILLISECOND,CURRENT_TIMESTAMP()) AND (C.AT IS NULL OR R.TS>C.AT)), PARTS AS (SELECT P.PART,COUNT(R.ID) N,SHA2(COALESCE(LISTAGG(R.ID||':'||SHA2(R.WIRE,256),'\\n') WITHIN GROUP(ORDER BY COLLATE(R.ID,'utf8')),''),256) D FROM DELIVERY_PART_V1 P LEFT JOIN LIVE R ON R.PART=P.PART WHERE P.TENANT=? AND P.GENERATION=? AND P.SOURCE=? AND P.SOURCE_SEQUENCE=? GROUP BY P.PART), CHAIN(PART,N,D) AS (SELECT -1,0,SHA2('',256) UNION ALL SELECT P.PART,C.N+P.N,SHA2(C.D||CHAR(10)||P.D,256) FROM CHAIN C JOIN PARTS P ON P.PART=C.PART+1) SELECT N,D FROM CHAIN WHERE PART=?";
 var result=q(sql,[tenant,generation,source,sequence,tenant,generation,source,sequence,part]);
 if(!result.next())throw 'incomplete source';return {count:result.getColumnValue(1),digest:result.getColumnValue(2)};
}
var p=JSON.parse(WIRE),digest=scalar('SELECT SHA2(?,256)',[WIRE]);
bad(p.version===1&&/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(p.tenant)&&/^[a-f0-9]{64}$/.test(p.generation)
 &&/^[a-f0-9-]{36}$/.test(p.operation)&&Number.isSafeInteger(p.sequence)&&p.sequence>0
 &&Number.isSafeInteger(p.sourceSequence)&&p.sourceSequence>0&&p.sourceSequence<=p.sequence
 &&Number.isSafeInteger(p.part)&&p.part>=0&&typeof p.source==='string'&&p.source.length<=2048
 &&typeof p.revision==='string'&&p.revision.length<=256&&typeof p.final==='boolean'
 &&Number.isSafeInteger(p.total)&&p.total>=0&&/^[a-f0-9]{64}$/.test(p.sourceDigest)
 &&Array.isArray(p.rows)&&p.rows.length<=1000&&Array.isArray(p.cutoffs)&&p.cutoffs.length<=1000
 &&(p.mode==='replace'||p.mode==='barrier'&&p.rows.length===0&&p.final===false));
// Enforced-key conflict means retry; never proceed without the row lock.
q('MERGE INTO DELIVERY_LOCK_V1 T USING(SELECT ? TENANT) S ON T.TENANT=S.TENANT WHEN NOT MATCHED THEN INSERT(TENANT,SERIAL) VALUES(S.TENANT,0)',[p.tenant]);
q('BEGIN TRANSACTION');
try{
 q('SELECT SERIAL FROM DELIVERY_LOCK_V1 WHERE TENANT=? FOR UPDATE',[p.tenant]);
 var old=q('SELECT DIGEST FROM DELIVERY_OPERATION_V1 WHERE TENANT=? AND GENERATION=? AND OPERATION=?',[p.tenant,p.generation,p.operation]);
 if(old.next()){bad(old.getColumnValue(1)===digest);q('COMMIT');return {version:1,operation:p.operation,digest:digest,duplicate:true};}
 for(var i=0;i<p.cutoffs.length;i++){
  var c=p.cutoffs[i];bad(/^[a-f0-9]{32}$/.test(c.subject)&&Number.isSafeInteger(c.at)&&c.at>=0);
  q('MERGE INTO DELIVERY_CUTOFF_V1 T USING(SELECT ? TENANT,? SUBJECT,? AT) S ON T.TENANT=S.TENANT AND T.SUBJECT=S.SUBJECT WHEN MATCHED THEN UPDATE SET AT=GREATEST(T.AT,S.AT) WHEN NOT MATCHED THEN INSERT(TENANT,SUBJECT,AT) VALUES(S.TENANT,S.SUBJECT,S.AT)',[p.tenant,c.subject,c.at]);
 }
 q('DELETE FROM DELIVERY_ROW_V1 R USING DELIVERY_CUTOFF_V1 C WHERE R.TENANT=C.TENANT AND R.SUBJECT=C.SUBJECT AND R.TS<=C.AT AND R.TENANT=?',[p.tenant]);
 q('DELETE FROM DELIVERY_ROW_V1 WHERE TENANT=? AND EXPIRES_AT<=DATE_PART(EPOCH_MILLISECOND,CURRENT_TIMESTAMP())',[p.tenant]);
 var state=q('SELECT ADMITTED,COMMITTED,REVISION FROM DELIVERY_SOURCE_V1 WHERE TENANT=? AND GENERATION=? AND SOURCE=?',[p.tenant,p.generation,p.source]);
 var committed=0;
 if(state.next()){committed=state.getColumnValue(2);bad(p.sourceSequence>=state.getColumnValue(1)&&p.sourceSequence>committed);if(p.sourceSequence===state.getColumnValue(1))bad(p.revision===state.getColumnValue(3));}
 // A newer admission supersedes only this source's uncommitted staging. Keep
 // the previous COMMITTED cohort until exact complete proof and promotion.
 // This also fences a withdrawn sequence without deleting committed history.
 q('DELETE FROM DELIVERY_ROW_V1 WHERE TENANT=? AND GENERATION=? AND SOURCE=? AND SOURCE_SEQUENCE<>? AND SOURCE_SEQUENCE<>?',[p.tenant,p.generation,p.source,committed,p.sourceSequence]);
 q('DELETE FROM DELIVERY_PART_V1 WHERE TENANT=? AND GENERATION=? AND SOURCE=? AND SOURCE_SEQUENCE<>? AND SOURCE_SEQUENCE<>?',[p.tenant,p.generation,p.source,committed,p.sourceSequence]);
 q('MERGE INTO DELIVERY_SOURCE_V1 T USING(SELECT ? TENANT,? GENERATION,? SOURCE,? ADMITTED,? REVISION) S ON T.TENANT=S.TENANT AND T.GENERATION=S.GENERATION AND T.SOURCE=S.SOURCE WHEN MATCHED THEN UPDATE SET ADMITTED=S.ADMITTED,REVISION=S.REVISION WHEN NOT MATCHED THEN INSERT(TENANT,GENERATION,SOURCE,ADMITTED,COMMITTED,REVISION) VALUES(S.TENANT,S.GENERATION,S.SOURCE,S.ADMITTED,0,S.REVISION)',[p.tenant,p.generation,p.source,p.sourceSequence,p.revision]);
 var ids={},expected=[];
 for(var n=0;n<p.rows.length;n++){
  var r=p.rows[n];bad(typeof r.id==='string'&&r.id.length<=2048&&!ids[r.id]&&/^[a-f0-9]{32}$/.test(r.subject)
   &&Number.isSafeInteger(r.ts)&&r.ts>=0&&Number.isSafeInteger(r.expiresAt)&&r.expiresAt>r.ts
   &&/^[a-f0-9]{64}$/.test(r.hash)&&typeof r.wire==='string'&&r.wire.length<=1500000);ids[r.id]=true;
  var raw=scalar('SELECT BASE64_DECODE_STRING(?)',[r.wire]);bad(scalar('SELECT SHA2(?,256)',[raw])===r.hash);
  var record=JSON.parse(raw);bad(record.tenant===p.tenant&&record.visitor_id===r.subject&&record.ts===r.ts);
  bad(r.expiresAt>scalar('SELECT DATE_PART(EPOCH_MILLISECOND,CURRENT_TIMESTAMP())'));
  var cutoff=scalar('SELECT COALESCE(MAX(AT),-1) FROM DELIVERY_CUTOFF_V1 WHERE TENANT=? AND SUBJECT=?',[p.tenant,r.subject]);bad(r.ts>cutoff);
  bad(scalar('SELECT COUNT(*) FROM DELIVERY_ROW_V1 WHERE TENANT=? AND GENERATION=? AND ID=? AND HASH<>?',[p.tenant,p.generation,r.id,r.hash])===0);
  bad(scalar('SELECT COUNT(*) FROM DELIVERY_ROW_V1 WHERE TENANT=? AND GENERATION=? AND SOURCE=? AND SOURCE_SEQUENCE=? AND ID=?',[p.tenant,p.generation,p.source,p.sourceSequence,r.id])===0);
  q('INSERT INTO DELIVERY_ROW_V1 VALUES(?,?,?,?,?,?,?,?,?,?,?)',[p.tenant,p.generation,p.source,p.sourceSequence,p.part,r.id,r.subject,r.ts,r.expiresAt,r.hash,raw]);expected.push({id:r.id,hash:r.hash});
 }
 expected.sort(function(a,b){return a.id<b.id?-1:a.id>b.id?1:0;});
 if(p.mode==='replace'){
  bad(scalar('SELECT COUNT(*) FROM DELIVERY_PART_V1 WHERE TENANT=? AND GENERATION=? AND SOURCE=? AND SOURCE_SEQUENCE=? AND PART=?',[p.tenant,p.generation,p.source,p.sourceSequence,p.part])===0);
  q('INSERT INTO DELIVERY_PART_V1 VALUES(?,?,?,?,?)',[p.tenant,p.generation,p.source,p.sourceSequence,p.part]);
 }
 if(p.final){
  // Finalization covers the complete staged cohort, never just a requested
  // prefix while future parts would also become visible through COMMITTED.
  bad(scalar('SELECT COUNT(*) FROM DELIVERY_PART_V1 WHERE TENANT=? AND GENERATION=? AND SOURCE=? AND SOURCE_SEQUENCE=?',[p.tenant,p.generation,p.source,p.sourceSequence])===p.part+1);
  var proof=sourceProof(p.tenant,p.generation,p.source,p.sourceSequence,p.part),total=proof.count,chain=proof.digest;
  bad(total===p.total&&chain===p.sourceDigest);
  q('UPDATE DELIVERY_SOURCE_V1 SET COMMITTED=?,TOTAL=?,DIGEST=? WHERE TENANT=? AND GENERATION=? AND SOURCE=?',[p.sourceSequence,p.total,p.sourceDigest,p.tenant,p.generation,p.source]);
  q('DELETE FROM DELIVERY_ROW_V1 WHERE TENANT=? AND GENERATION=? AND SOURCE=? AND SOURCE_SEQUENCE<>?',[p.tenant,p.generation,p.source,p.sourceSequence]);
  q('DELETE FROM DELIVERY_PART_V1 WHERE TENANT=? AND GENERATION=? AND SOURCE=? AND SOURCE_SEQUENCE<>?',[p.tenant,p.generation,p.source,p.sourceSequence]);
 }
 // ROWS_EXPECTED is deliberately empty: original subject-bearing row IDs must
 // not survive their original lifetime in an unused operation metadata copy.
 q('INSERT INTO DELIVERY_OPERATION_V1 VALUES(?,?,?,?,?,?,?,?,TO_BOOLEAN(?),?,?,?,?)',[p.tenant,p.generation,p.operation,digest,p.sequence,p.source,p.sourceSequence,p.part,p.final?'true':'false',p.total,p.sourceDigest,'[]',JSON.stringify(p.cutoffs)]);
 q('COMMIT');return {version:1,operation:p.operation,digest:digest};
}catch(e){q('ROLLBACK');throw 'delivery transaction refused';}
$$;

CREATE OR REPLACE PROCEDURE READ_DELIVERY_V1(WIRE VARCHAR)
RETURNS VARIANT LANGUAGE JAVASCRIPT EXECUTE AS OWNER AS
$$
function q(sql,binds){return snowflake.createStatement({sqlText:sql,binds:binds||[]}).execute();}
function scalar(sql,binds){var r=q(sql,binds);if(!r.next())throw 'missing';return r.getColumnValue(1);}
function sourceProof(tenant,generation,source,sequence,part){
 // One bounded set query over the retained source, not one SQL round trip per
 // upload part. Hash actual row WIRE, not the cached operation receipt.
 var sql="WITH RECURSIVE LIVE AS (SELECT R.* FROM DELIVERY_ROW_V1 R LEFT JOIN DELIVERY_CUTOFF_V1 C ON C.TENANT=R.TENANT AND C.SUBJECT=R.SUBJECT WHERE R.TENANT=? AND R.GENERATION=? AND R.SOURCE=? AND R.SOURCE_SEQUENCE=? AND R.EXPIRES_AT>DATE_PART(EPOCH_MILLISECOND,CURRENT_TIMESTAMP()) AND (C.AT IS NULL OR R.TS>C.AT)), PARTS AS (SELECT P.PART,COUNT(R.ID) N,SHA2(COALESCE(LISTAGG(R.ID||':'||SHA2(R.WIRE,256),'\\n') WITHIN GROUP(ORDER BY COLLATE(R.ID,'utf8')),''),256) D FROM DELIVERY_PART_V1 P LEFT JOIN LIVE R ON R.PART=P.PART WHERE P.TENANT=? AND P.GENERATION=? AND P.SOURCE=? AND P.SOURCE_SEQUENCE=? GROUP BY P.PART), CHAIN(PART,N,D) AS (SELECT -1,0,SHA2('',256) UNION ALL SELECT P.PART,C.N+P.N,SHA2(C.D||CHAR(10)||P.D,256) FROM CHAIN C JOIN PARTS P ON P.PART=C.PART+1) SELECT N,D FROM CHAIN WHERE PART=?";
 var result=q(sql,[tenant,generation,source,sequence,tenant,generation,source,sequence,part]);
 if(!result.next())throw 'incomplete source';return {count:result.getColumnValue(1),digest:result.getColumnValue(2)};
}
var p=JSON.parse(WIRE);if(!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(p.tenant)||!/^[a-f0-9]{64}$/.test(p.generation)||!/^[a-f0-9-]{36}$/.test(p.operation))throw 'read refused';
q('BEGIN TRANSACTION');
try{
 q('SELECT SERIAL FROM DELIVERY_LOCK_V1 WHERE TENANT=? FOR UPDATE',[p.tenant]);
 q('DELETE FROM DELIVERY_ROW_V1 WHERE TENANT=? AND EXPIRES_AT<=DATE_PART(EPOCH_MILLISECOND,CURRENT_TIMESTAMP())',[p.tenant]);
 var r=q('SELECT DIGEST,SEQUENCE,SOURCE,SOURCE_SEQUENCE,PART,FINAL,TOTAL,SOURCE_DIGEST,CUTOFFS_EXPECTED FROM DELIVERY_OPERATION_V1 WHERE TENANT=? AND GENERATION=? AND OPERATION=?',[p.tenant,p.generation,p.operation]);
 if(!r.next()||r.getColumnValue(1)!==p.digest)throw 'read refused';
 var sequence=r.getColumnValue(2),source=r.getColumnValue(3),ss=r.getColumnValue(4),part=r.getColumnValue(5),final=r.getColumnValue(6);
 var rs=q('SELECT R.ID,SHA2(R.WIRE,256) FROM DELIVERY_ROW_V1 R LEFT JOIN DELIVERY_CUTOFF_V1 C ON C.TENANT=R.TENANT AND C.SUBJECT=R.SUBJECT WHERE R.TENANT=? AND R.GENERATION=? AND R.SOURCE=? AND R.SOURCE_SEQUENCE=? AND R.PART=? AND R.EXPIRES_AT>DATE_PART(EPOCH_MILLISECOND,CURRENT_TIMESTAMP()) AND (C.AT IS NULL OR R.TS>C.AT) ORDER BY COLLATE(R.ID,\'utf8\')',[p.tenant,p.generation,source,ss,part]);
 var rows=[];while(rs.next())rows.push({id:rs.getColumnValue(1),hash:rs.getColumnValue(2)});
 var cutoffs=JSON.parse(r.getColumnValue(9));for(var n=0;n<cutoffs.length;n++)cutoffs[n].at=scalar('SELECT MAX(AT) FROM DELIVERY_CUTOFF_V1 WHERE TENANT=? AND SUBJECT=?',[p.tenant,cutoffs[n].subject]);
 var count=null,digest=null;
 if(final){
  var state=q('SELECT COMMITTED FROM DELIVERY_SOURCE_V1 WHERE TENANT=? AND GENERATION=? AND SOURCE=?',[p.tenant,p.generation,source]);if(!state.next()||state.getColumnValue(1)!==ss)throw 'source changed';
  var proof=sourceProof(p.tenant,p.generation,source,ss,part);count=proof.count;digest=proof.digest;
 }
 var expired=scalar('SELECT COUNT(*) FROM DELIVERY_ROW_V1 WHERE TENANT=? AND EXPIRES_AT<=DATE_PART(EPOCH_MILLISECOND,CURRENT_TIMESTAMP())',[p.tenant]);
 q('COMMIT');return {version:1,operation:p.operation,digest:p.digest,sequence:sequence,rows:rows,count:rows.length,sourceCount:count,sourceDigest:digest,cutoffs:cutoffs,currentRowsOnly:true,expiredRemaining:expired};
}catch(e){q('ROLLBACK');throw 'current readback unavailable';}
$$;

-- The Worker schedules an empty maintenance delivery and current readback for
-- quiet/retired generations at the retained approved cadence. Both procedures
-- physically remove expired current-table rows under the same tenant lock.
-- Installation, actual execution/cadence and Time Travel/Fail-safe/clones/backups
-- remain separate live evidence. Grant procedure USAGE and secure
-- view SELECT only, not direct table mutation or procedure ownership.
