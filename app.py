import streamlit as st

from src.llm import MODEL, ask

st.set_page_config(page_title="WTQ 2026", page_icon="✨")
st.title("Women Tech Quest 2026")
st.caption(f"Model: {MODEL}")

prompt = st.text_area("Ask something")
if st.button("Send") and prompt.strip():
    with st.spinner("Thinking..."):
        try:
            st.write(ask(prompt))
        except Exception as e:
            st.error(str(e))
